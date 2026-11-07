import io
import json

import pytest

from app import llm


def make(client):
    return client.post("/api/papers", json={"title": "P"}).json()


def stream(client, pid, **body):
    r = client.post(f"/api/papers/{pid}/explain/stream", json=body)
    return r, [json.loads(line) for line in r.text.splitlines() if line.strip()]


def test_answer_arrives_in_pieces_and_is_saved(client, monkeypatch):
    monkeypatch.setattr(llm, "explain_stream", lambda paper, passage, question, **kw: iter(["It means ", "a **simple** idea."]))
    p = make(client)
    r, lines = stream(client, p["id"], passage="x", mode="simplify")
    assert r.headers["content-type"].startswith("application/x-ndjson")
    assert lines == [{"text": "It means "}, {"text": "a **simple** idea."}, {"done": True}]
    saved = client.get(f"/api/papers/{p['id']}/explanations").json()
    assert [(e["passage"], e["answer"], e["mode"]) for e in saved] == [("x", "It means a **simple** idea.", "simplify")]


def test_an_error_midway_is_reported_and_nothing_is_saved(client, monkeypatch):
    def broken(paper, passage, question, **kw):
        yield "Half an ans"
        raise llm.AIError("Claude request failed: overloaded")

    monkeypatch.setattr(llm, "explain_stream", broken)
    p = make(client)
    _, lines = stream(client, p["id"], question="What is it?")
    assert lines == [{"text": "Half an ans"}, {"error": "Claude request failed: overloaded"}]
    assert client.get(f"/api/papers/{p['id']}/explanations").json() == []


def test_bad_requests_are_refused_before_streaming(client):
    p = make(client)
    assert client.post(f"/api/papers/{p['id']}/explain/stream", json={"passage": " "}).status_code == 400
    assert client.post(f"/api/papers/{p['id']}/explain/stream", json={"passage": "x", "mode": "translate"}).status_code == 400
    assert client.post("/api/papers/999/explain/stream", json={"passage": "x"}).status_code == 404


class FakeProcess:
    def __init__(self, lines, returncode=0):
        self.stdin = io.StringIO()
        self.stdout = iter(json.dumps(x) + "\n" for x in lines)
        self.stderr = io.StringIO("")
        self.returncode = returncode

    def wait(self, timeout=None):
        return self.returncode

    def poll(self):
        return self.returncode

    def kill(self):
        pass


def delta(text):
    return {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}}


@pytest.mark.llm_plumbing
def test_claude_code_text_is_passed_on_as_it_arrives(monkeypatch):
    seen = {}

    def popen(args, **kw):
        seen["args"] = args
        return FakeProcess([{"type": "system", "subtype": "init"}, delta("Hel"), delta("lo"),
                            {"type": "assistant", "message": {}}, {"type": "result", "is_error": False, "result": "Hello"}])

    monkeypatch.setattr(llm, "claude_binary", lambda: "claude")
    monkeypatch.setattr(llm.subprocess, "Popen", popen)
    assert list(llm._claude_code_stream("hi", "system text")) == ["Hel", "lo"]
    assert "stream-json" in seen["args"] and "--include-partial-messages" in seen["args"]


@pytest.mark.llm_plumbing
def test_claude_code_errors_become_ai_errors(monkeypatch):
    monkeypatch.setattr(llm, "claude_binary", lambda: "claude")
    monkeypatch.setattr(llm.subprocess, "Popen", lambda args, **kw: FakeProcess(
        [{"type": "result", "is_error": True, "result": "Invalid API key · Please run /login"}]))
    with pytest.raises(llm.AIError, match="isn't signed in"):
        list(llm._claude_code_stream("hi"))
