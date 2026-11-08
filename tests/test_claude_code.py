"""The 'my Claude subscription' backend: the app runs the official Claude Code CLI (`claude -p`),
which signs in with the user's own account. We never touch its credentials."""
import io
import json
import subprocess

import pytest

from papers import llm
from papers.ai import claude_code, providers

pytestmark = pytest.mark.llm_plumbing


class FakeCLI:
    def __init__(self, payload, returncode=0):
        self.payload, self.returncode, self.calls = payload, returncode, []

    def __call__(self, args, **kw):
        self.calls.append((args, kw))
        out = self.payload if isinstance(self.payload, str) else json.dumps(self.payload)
        return subprocess.CompletedProcess(args, self.returncode, stdout=out, stderr="")


@pytest.fixture
def cli(client, monkeypatch):
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    monkeypatch.setattr(providers, "claude_binary", lambda: "C:/claude/claude.exe")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-leak")

    def use(payload, returncode=0):
        fake = FakeCLI(payload, returncode)
        monkeypatch.setattr(claude_code.subprocess, "run", fake)
        return fake
    return use


def test_structured_calls_go_through_claude_code(cli):
    fake = cli({"is_error": False, "result": "", "structured_output": {"queries": ["a", "b"]}})
    assert llm.search_queries("diffusion") == ["a", "b"]
    args, kw = fake.calls[0]
    assert args[0] == "C:/claude/claude.exe" and "-p" in args and "--json-schema" in args
    assert args[args.index("--tools") + 1] == ""  # no file or shell access
    assert "diffusion" in kw["input"]
    assert "ANTHROPIC_API_KEY" not in kw["env"]  # or Claude Code would bill the API key instead


def test_text_answers_and_json_in_result_text(cli):
    cli({"is_error": False, "result": "Plainly put, it adds noise."})
    assert claude_code.run("passage", "system") == "Plainly put, it adds noise."
    cli({"is_error": False, "result": '```json\n{"queries": ["x"]}\n```'})
    assert llm.search_queries("g") == ["x"]


def test_cli_errors_become_friendly_ai_errors(cli, monkeypatch):
    cli({"is_error": True, "result": "Failed to authenticate: OAuth session expired and could not be refreshed"})
    with pytest.raises(llm.AIError, match="sign in"):
        llm.search_queries("g")
    cli("not json at all", returncode=1)
    with pytest.raises(llm.AIError, match="Claude Code"):
        llm.search_queries("g")
    monkeypatch.setattr(providers, "claude_binary", lambda: None)
    with pytest.raises(llm.AIError, match="install"):
        llm.search_queries("g")


def test_configured_depends_on_backend(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert providers.configured() is False
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    monkeypatch.setattr(providers, "claude_binary", lambda: None)
    assert providers.configured() is False
    monkeypatch.setattr(providers, "claude_binary", lambda: "claude")
    assert providers.configured() is True


def test_settings_report_and_test_the_backend(client, monkeypatch):
    s = client.get("/api/settings").json()
    assert s["ai_backend"] == "api"
    assert client.put("/api/settings", json={"ai_backend": "nonsense"}).status_code == 422
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    monkeypatch.setattr(providers, "claude_binary", lambda: "C:/claude/claude.exe")
    monkeypatch.setattr(claude_code.subprocess, "run", FakeCLI({"is_error": False, "result": "", "structured_output": {"queries": ["ok"]}}))
    s = client.get("/api/settings").json()
    assert (s["ai_backend"], s["claude_binary"]) == ("claude-code", "C:/claude/claude.exe")
    assert client.post("/api/ai/test").json() == {"ok": True, "message": "It works: Claude answered through your Claude subscription."}


def test_library_folder_setting_is_unaffected(client, tmp_path):
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    r = client.put("/api/settings", json={"library_dir": str(tmp_path / "P")}).json()
    assert r["library_dir"] == str(tmp_path / "P") and r["ai_backend"] == "claude-code"


def test_long_instructions_go_through_a_file_not_the_command_line(cli, monkeypatch):
    """Windows rejects command lines over ~32k characters ([WinError 206]); a paper is longer."""
    seen = {}

    class Process:  # explanations stream, so they go through Popen
        def __init__(self, args, **kw):
            i = args.index("--system-prompt-file")
            with open(args[i + 1], encoding="utf-8") as f:
                seen["system"] = f.read()
            seen["longest_arg"] = max(len(a) for a in args)
            self.stdin = io.StringIO()
            self.stdout = iter([json.dumps({"type": "stream_event", "event": {"type": "content_block_delta",
                                "delta": {"type": "text_delta", "text": "ok"}}}) + "\n"])
            self.stderr = io.StringIO("")

        def wait(self, timeout=None):
            return 0

        def poll(self):
            return 0

    monkeypatch.setattr(claude_code.subprocess, "Popen", Process)
    paper = {"title": "Long", "text": "word " * 20000}
    assert llm.explain(paper, "passage", "") == "ok"
    assert "word word" in seen["system"] and seen["longest_arg"] < 2000
