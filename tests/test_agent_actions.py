"""Deep mode's actions: the AI saves notes, highlights, words and papers when asked; each shows in the answer and
can be undone; there's a limit per answer."""
import json
import os
import subprocess
import sys

from papers import scholar
from papers.agent import loop, tools
from papers.chat import store

TEXT = "1 Introduction We add positional encodings to the input embeddings. 2 Method The model uses attention."


def paper(client):
    p = client.post("/api/papers", json={"title": "Attention", "abstract": "transformers"}).json()
    from papers.store import update_paper
    update_paper(p["id"], text=TEXT)
    return p


def deep_answer(client, monkeypatch, p, calls):
    """A Deep answer whose agent makes these tool calls [(name, args)], through the real _call()."""
    def fake(paper, turns, language="", figures=None):
        for i, (name, args) in enumerate(calls):
            yield from loop._call(paper, f"c{i}", name, args)
        yield "Done."

    monkeypatch.setattr(loop, "run", fake)
    r = client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "Please", "depth": "deep"})
    return [json.loads(line) for line in r.text.splitlines()]


def test_a_note_and_a_highlight_are_saved_marked_and_undone(client, monkeypatch):
    p = paper(client)
    events = deep_answer(client, monkeypatch, p, [
        ("save_note", {"text": "Position is added, not concatenated.", "quote": "add positional encodings"}),
        ("highlight", {"quote": "positional encodings to the input embeddings", "color": "green"}),
    ])
    actions = [e["action"] for e in events if e["type"] == "action"]
    assert [a["kind"] for a in actions] == ["note", "highlight"]
    notes = client.get(f"/api/papers/{p['id']}/notes").json()
    assert {(n["kind"], n["source"]) for n in notes} == {("note", "ai"), ("highlight", "ai")}
    message = events[-1]["message"]
    assert [a["kind"] for a in message["meta"]["actions"]] == ["note", "highlight"]
    undone = client.post(f"/api/messages/{message['id']}/undo", json={"index": 0}).json()
    assert undone["meta"]["actions"][0]["undone"] is True
    assert [n["kind"] for n in client.get(f"/api/papers/{p['id']}/notes").json()] == ["highlight"]


def test_a_highlight_needs_the_exact_text(client):
    p = paper(client)
    r = tools.run("highlight", p["id"], {"quote": "words that are not in the paper", "color": "yellow"})
    assert r.data == {} and "isn't in the paper" in r.text


def test_a_word_is_added_and_undone(client, monkeypatch):
    p = paper(client)
    events = deep_answer(client, monkeypatch, p, [("save_word", {"term": "embedding", "meaning": "a list of numbers for a word",
                                                                 "kind": "technical", "example": "", "translation": ""})])
    words = client.get(f"/api/papers/{p['id']}").json()["glossary"]
    assert words[0]["term"] == "embedding" and words[0]["source"] == "ai"
    client.post(f"/api/messages/{events[-1]['message']['id']}/undo", json={"index": 0})
    assert client.get(f"/api/papers/{p['id']}").json()["glossary"] == []


def test_a_paper_is_added_from_the_references_and_undone(client, monkeypatch):
    monkeypatch.setattr(scholar, "resolve", lambda title: None)
    p = paper(client)
    events = deep_answer(client, monkeypatch, p, [("add_paper", {"title": "Layer Normalization"})])
    added = next(e["action"] for e in events if e["type"] == "action")
    linked = client.get(f"/api/papers/{added['id']}").json()
    assert linked["title"] == "Layer Normalization" and linked["source_paper_id"] == p["id"]
    client.post(f"/api/messages/{events[-1]['message']['id']}/undo", json={"index": 0})
    assert client.get(f"/api/papers/{added['id']}").status_code == 404


def test_at_most_five_changes_per_answer(client, monkeypatch):
    p = paper(client)
    events = deep_answer(client, monkeypatch, p, [("save_note", {"text": f"note {i}", "quote": ""}) for i in range(7)])
    assert len([e for e in events if e["type"] == "action"]) == 5
    assert len(client.get(f"/api/papers/{p['id']}/notes").json()) == 5


def test_the_mcp_server_reports_what_it_changed(client):
    p = paper(client)
    talk = [{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": "save_note", "arguments": {"text": "From Claude Code", "quote": ""}}}]
    done = subprocess.run([sys.executable, "-m", "papers.agent.mcp_server", "--paper", str(p["id"])],
                          input=json.dumps(talk[0]) + "\n", capture_output=True, text=True, env=dict(os.environ), timeout=60)
    text = json.loads(done.stdout.splitlines()[0])["result"]["content"][0]["text"]
    marker = loop.ACTION_MARK.search(text)
    assert marker and json.loads(marker.group(1))["kind"] == "note"
    assert client.get(f"/api/papers/{p['id']}/notes").json()[0]["body"] == "From Claude Code"


def test_undo_twice_is_harmless(client, monkeypatch):
    p = paper(client)
    events = deep_answer(client, monkeypatch, p, [("save_note", {"text": "x", "quote": ""})])
    mid = events[-1]["message"]["id"]
    assert client.post(f"/api/messages/{mid}/undo", json={"index": 0}).status_code == 200
    assert client.post(f"/api/messages/{mid}/undo", json={"index": 0}).status_code == 200
    assert client.post(f"/api/messages/{mid}/undo", json={"index": 5}).status_code == 404
    assert store.get_message(mid)["meta"]["actions"][0]["undone"] is True
