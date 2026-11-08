"""One list of providers, Claude included, each chosen the same way; subscriptions through their official CLIs."""
import json
import subprocess
from pathlib import Path

import pytest

from papers import llm
from papers.ai import anthropic_api, claude_code, providers


def put(client, **body):
    return client.put("/api/settings", json=body).json()


def test_every_provider_is_chosen_the_same_way(client):
    assert {p["group"] for p in put(client)["providers"]} == {"subscription", "key", "local", "other"}
    for provider, backend in [("claude-plan", "claude-code"), ("chatgpt-plan", "codex"), ("anthropic", "api"),
                              ("openai", "openai"), ("gemini", "openai"), ("ollama", "openai")]:
        s = put(client, ai_provider=provider)
        assert (s["ai_provider"], s["ai_backend"]) == (provider, backend)


def test_each_provider_keeps_its_own_key_and_model(client):
    put(client, ai_provider="openai", ai_api_key="sk-openai", ai_model="model-a")
    s = put(client, ai_provider="gemini")
    assert (s["ai_key_set"], s["ai_model"]) == (False, "")
    s = put(client, ai_provider="openai")
    assert (s["ai_key_set"], s["ai_model"]) == (True, "model-a")
    assert "sk-openai" not in json.dumps(s)


@pytest.mark.llm_plumbing
def test_anthropic_key_can_be_set_in_settings(client, monkeypatch):
    seen = {}

    class FakeAnthropic:
        def __init__(self, api_key=None, **kw):
            seen["key"] = api_key

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(anthropic_api.anthropic, "Anthropic", FakeAnthropic)
    s = put(client, ai_provider="anthropic", ai_api_key="sk-ant-test")
    assert s["ai_ready"] is True
    anthropic_api.client()
    assert seen["key"] == "sk-ant-test"


class FakeCodex:
    """Plays `codex exec`: reads the prompt from stdin and writes the final answer to the -o file."""

    def __init__(self, answer="", returncode=0, stderr=""):
        self.answer, self.returncode, self.stderr, self.calls = answer, returncode, stderr, []

    def __call__(self, args, **kw):
        self.calls.append((args, kw))
        if "--output-schema" in args:
            self.schema = json.loads(Path(args[args.index("--output-schema") + 1]).read_text(encoding="utf-8"))
        if self.returncode == 0:
            Path(args[args.index("-o") + 1]).write_text(self.answer, encoding="utf-8")
        return subprocess.CompletedProcess(args, self.returncode, stdout=self.answer, stderr=self.stderr)


@pytest.fixture
def codex(client, monkeypatch):
    put(client, ai_provider="chatgpt-plan")
    monkeypatch.setattr(providers, "codex_binary", lambda: "C:/codex/codex.exe")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-be-used")

    def use(*a, **kw):
        fake = FakeCodex(*a, **kw)
        monkeypatch.setattr(claude_code.subprocess, "run", fake)
        return fake
    return use


@pytest.mark.llm_plumbing
def test_chatgpt_plan_answers_through_codex(codex):
    fake = codex('{"queries": ["a", "b"]}')
    assert llm.search_queries("diffusion") == ["a", "b"]
    args, kw = fake.calls[0]
    assert args[:3] == ["C:/codex/codex.exe", "exec", "-"]  # the prompt comes on stdin (papers are long)
    for flag in ("--skip-git-repo-check", "--ephemeral", "--output-schema", "-o"):
        assert flag in args
    assert args[args.index("--sandbox") + 1] == "read-only"
    assert "diffusion" in kw["input"]
    assert "OPENAI_API_KEY" not in kw["env"] and "CODEX_API_KEY" not in kw["env"]  # use the ChatGPT plan, not a key
    assert fake.schema["additionalProperties"] is False and fake.schema["required"] == ["queries"]


@pytest.mark.llm_plumbing
def test_chatgpt_plan_explanations_and_errors(codex):
    codex("It adds noise step by step.")
    assert "".join(llm.explain_stream({"title": "P", "text": "body"}, "passage")) == "It adds noise step by step."
    codex(returncode=1, stderr="Error: Not logged in. Please run codex login")
    with pytest.raises(llm.AIError, match="codex login"):
        llm.search_queries("g")


def test_chatgpt_plan_needs_codex_installed(client, monkeypatch):
    monkeypatch.setattr(providers, "codex_binary", lambda: None)
    assert put(client, ai_provider="chatgpt-plan")["ai_ready"] is False
