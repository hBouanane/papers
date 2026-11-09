"""Answers never hang: thinking is told apart from the answer, a silent model is given up on, an empty answer is
an error (never saved), and stopping ends the model's run."""
import json
import threading
import time

import httpx
import pytest

from papers import llm
from papers.ai import openai_compat, streaming
from papers.ai.errors import AIError
from papers.ai.streaming import Thinking, ThinkTags, guarded


def split(pieces):
    tags = ThinkTags()
    out = [p for piece in pieces for p in tags.feed(piece)] + list(tags.flush())
    return "".join(p for p in out if isinstance(p, Thinking)), "".join(p for p in out if not isinstance(p, Thinking))


def test_think_tags_are_split_out_even_across_pieces():
    assert split(["<think>Let me", " see</th", "ink>The answer", " is 4."]) == ("Let me see", "The answer is 4.")
    assert split(["No tags at all <", "3"]) == ("", "No tags at all <3")
    assert split(["<thi", "nk>only thinking"]) == ("only thinking", "")


def test_guard_passes_pieces_and_errors_on():
    assert list(guarded(lambda: iter(["a", "b"]))) == ["a", "b"]

    def broken():
        yield "a"
        raise AIError("overloaded")

    with pytest.raises(AIError, match="overloaded"):
        list(guarded(broken))


def test_guard_gives_up_on_a_silent_model():
    def silent():
        yield "start"
        time.sleep(5)
        yield "too late"

    got = []
    with pytest.raises(AIError, match="stopped answering"):
        for piece in guarded(silent, idle=0.3):
            got.append(piece)
    assert got == ["start"]


def test_stopping_closes_the_model_stream():
    closed = threading.Event()

    def endless():
        try:
            while True:
                yield "word "
                time.sleep(0.01)
        finally:
            closed.set()

    stream = guarded(endless)
    next(stream)
    stream.close()  # the reader pressed Stop
    assert closed.wait(2)


@pytest.mark.llm_plumbing
def test_reasoning_models_stream_their_thinking_apart(client, monkeypatch):
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "openrouter", "ai_api_key": "k", "ai_model": "thinker"})
    events = [{"reasoning": "Hmm, "}, {"reasoning": "positions…"}, {"content": "Each position gets "}, {"content": "a pattern."}]
    sse = "".join(f"data: {json.dumps({'choices': [{'delta': d}]})}\n\n" for d in events) + "data: [DONE]\n\n"
    monkeypatch.setattr(openai_compat, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, text=sse)))
    pieces = list(openai_compat.stream("system", "question"))
    assert [p for p in pieces if isinstance(p, Thinking)] == ["Hmm, ", "positions…"]
    assert "".join(p for p in pieces if not isinstance(p, Thinking)) == "Each position gets a pattern."


def make(client):
    return client.post("/api/papers", json={"title": "P"}).json()


def stream(client, pid, **body):
    r = client.post(f"/api/papers/{pid}/explain/stream", json=body)
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


def test_thinking_is_passed_on_but_not_saved(client, monkeypatch):
    monkeypatch.setattr(llm, "explain_stream", lambda *a, **kw: iter([Thinking("let me think"), "The answer."]))
    p = make(client)
    assert stream(client, p["id"], passage="x") == [{"thinking": "let me think"}, {"text": "The answer."}, {"done": True}]
    assert client.get(f"/api/papers/{p['id']}/explanations").json()[0]["answer"] == "The answer."


def test_an_empty_answer_is_an_error_and_not_saved(client, monkeypatch):
    monkeypatch.setattr(llm, "explain_stream", lambda *a, **kw: iter([Thinking("thought for ages"), "  "]))
    p = make(client)
    lines = stream(client, p["id"], passage="x")
    assert lines[-1]["error"].startswith("No answer came back")
    assert client.get(f"/api/papers/{p['id']}/explanations").json() == []


def test_a_silent_model_ends_with_an_error(client, monkeypatch):
    monkeypatch.setattr(streaming, "IDLE_SECONDS", 0.3)

    def silent(*a, **kw):
        time.sleep(3)
        yield "late"

    monkeypatch.setattr(llm, "explain_stream", silent)
    p = make(client)
    assert "stopped answering" in stream(client, p["id"], passage="x")[-1]["error"]
