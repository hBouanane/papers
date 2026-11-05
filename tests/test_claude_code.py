"""The 'my Claude subscription' backend: the app runs the official Claude Code CLI (`claude -p`),
which signs in with the user's own account. We never touch its credentials."""
import json
import subprocess

import pytest

from app import llm


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
    monkeypatch.setattr(llm, "claude_binary", lambda: "C:/claude/claude.exe")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-leak")

    def use(payload, returncode=0):
        fake = FakeCLI(payload, returncode)
        monkeypatch.setattr(llm.subprocess, "run", fake)
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
    assert llm.explain({"title": "P", "text": "body"}, "passage", "") == "Plainly put, it adds noise."
    cli({"is_error": False, "result": '```json\n{"queries": ["x"]}\n```'})
    assert llm.search_queries("g") == ["x"]


def test_cli_errors_become_friendly_ai_errors(cli, monkeypatch):
    cli({"is_error": True, "result": "Failed to authenticate: OAuth session expired and could not be refreshed"})
    with pytest.raises(llm.AIError, match="sign in"):
        llm.search_queries("g")
    cli("not json at all", returncode=1)
    with pytest.raises(llm.AIError, match="Claude Code"):
        llm.search_queries("g")
    monkeypatch.setattr(llm, "claude_binary", lambda: None)
    with pytest.raises(llm.AIError, match="install"):
        llm.search_queries("g")


def test_configured_depends_on_backend(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert llm.configured() is False
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    monkeypatch.setattr(llm, "claude_binary", lambda: None)
    assert llm.configured() is False
    monkeypatch.setattr(llm, "claude_binary", lambda: "claude")
    assert llm.configured() is True


def test_settings_report_and_test_the_backend(client, monkeypatch):
    s = client.get("/api/settings").json()
    assert s["ai_backend"] == "api"
    assert client.put("/api/settings", json={"ai_backend": "nonsense"}).status_code == 422
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    monkeypatch.setattr(llm, "claude_binary", lambda: "C:/claude/claude.exe")
    monkeypatch.setattr(llm.subprocess, "run", FakeCLI({"is_error": False, "result": "", "structured_output": {"queries": ["ok"]}}))
    s = client.get("/api/settings").json()
    assert (s["ai_backend"], s["claude_binary"]) == ("claude-code", "C:/claude/claude.exe")
    assert client.post("/api/ai/test").json() == {"ok": True, "message": "Claude answered through Claude Code."}


def test_library_folder_setting_is_unaffected(client, tmp_path):
    client.put("/api/settings", json={"ai_backend": "claude-code"})
    r = client.put("/api/settings", json={"library_dir": str(tmp_path / "P")}).json()
    assert r["library_dir"] == str(tmp_path / "P") and r["ai_backend"] == "claude-code"
