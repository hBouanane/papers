"""Conversations: each Explain or question starts one, follow-ups continue it with its context, everything is kept
(done, failed or stopped), and History lists them."""
import json

from papers import db, llm
from papers.ai.streaming import Thinking
from papers.chat import answer, store


def make(client):
    return client.post("/api/papers", json={"title": "Attention", "abstract": "transformers"}).json()


def events(r):
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


def fake_model(monkeypatch, *replies):
    """The model answers with these, in turn; returns the conversations it was given."""
    seen = []
    queue = list(replies)

    def stream(paper, turns, language=""):
        seen.append(turns)
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        yield from reply

    monkeypatch.setattr(llm, "conversation_stream", stream)
    return seen


def test_explain_starts_a_conversation_and_a_follow_up_continues_it(client, monkeypatch):
    seen = fake_model(monkeypatch, ["Order is lost ", "without it."], ["Because sine waves repeat."])
    p = make(client)
    start = events(client.post(f"/api/papers/{p['id']}/conversations/start",
                               json={"kind": "explain", "attachments": [{"text": "PE(pos, 2i) = sin(...)"}]}))
    assert [e["type"] for e in start] == ["conversation", "user", "text", "text", "done"]
    cid = start[0]["conversation"]["id"]
    follow = events(client.post(f"/api/conversations/{cid}/messages", json={"content": "Why sine?"}))
    assert follow[-1]["type"] == "done" and follow[-1]["message"]["content"] == "Because sine waves repeat."
    # the follow-up saw the passage and the first answer
    second = seen[1]
    assert second[0]["attachments"][0]["text"] == "PE(pos, 2i) = sin(...)" and second[0]["kind"] == "explain"
    assert second[1] == {"role": "assistant", "kind": "explain", "content": "Order is lost without it.", "attachments": []}
    assert second[2]["content"] == "Why sine?"
    c = client.get(f"/api/conversations/{cid}").json()
    assert [m["role"] for m in c["messages"]] == ["user", "assistant", "user", "assistant"]
    assert c["title"] == "Explain: PE(pos, 2i) = sin(...)"
    listed = client.get(f"/api/papers/{p['id']}/conversations").json()
    assert listed[0]["id"] == cid and listed[0]["messages"] == 4 and listed[0]["preview"] == "Because sine waves repeat."


def test_follow_up_questions_are_taken_out_of_the_answer(client, monkeypatch):
    fake_model(monkeypatch, ["It adds position.\n\n```followups\n- Why sine and cosine?\n- What is d_model?\n```"])
    p = make(client)
    done = events(client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "What is PE?"}))[-1]
    assert done["message"]["content"] == "It adds position."
    assert done["message"]["meta"]["followups"] == ["Why sine and cosine?", "What is d_model?"]


def test_thinking_is_kept_with_the_answer(client, monkeypatch):
    fake_model(monkeypatch, [Thinking("let me see"), "Answer."])
    p = make(client)
    lines = events(client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "Q?"}))
    assert {"type": "thinking", "thinking": "let me see"} in lines
    assert lines[-1]["message"]["thinking"] == "let me see"


def test_a_failed_answer_is_kept_and_retry_replaces_it(client, monkeypatch):
    fake_model(monkeypatch, llm.AIError("overloaded"), ["Second time lucky."])
    p = make(client)
    lines = events(client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "Q?"}))
    assert lines[-1]["type"] == "error" and lines[-1]["error"] == "overloaded"
    cid = lines[0]["conversation"]["id"]
    assert client.get(f"/api/conversations/{cid}").json()["messages"][-1]["status"] == "error"
    again = events(client.post(f"/api/conversations/{cid}/retry"))
    assert again[-1]["type"] == "done"
    messages = client.get(f"/api/conversations/{cid}").json()["messages"]
    assert [(m["role"], m["status"]) for m in messages] == [("user", "done"), ("assistant", "done")]


def test_an_empty_answer_is_an_error(client, monkeypatch):
    fake_model(monkeypatch, [Thinking("only thinking"), "   "])
    p = make(client)
    last = events(client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "Q?"}))[-1]
    assert last["type"] == "error" and last["error"] == answer.NO_ANSWER


def test_stopping_keeps_what_was_written(client, monkeypatch):
    p = make(client)
    c = store.create(p["id"])
    store.add_message(c["id"], "user", content="Q?")

    def endless(paper, turns, language=""):
        while True:
            yield "word "

    monkeypatch.setattr(llm, "conversation_stream", endless)
    stream = answer.reply(c["id"], client.get(f"/api/papers/{p['id']}").json())
    next(stream), next(stream)
    stream.close()  # Stop
    last = store.get(c["id"])["messages"][-1]
    assert last["status"] == "stopped" and last["content"].startswith("word")


def test_translate_needs_a_language_and_a_message_needs_something(client):
    p = make(client)
    assert client.post(f"/api/papers/{p['id']}/conversations/start",
                       json={"kind": "translate", "attachments": [{"text": "x"}]}).status_code == 400
    assert client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "  "}).status_code == 422


def test_rename_and_delete(client, monkeypatch):
    fake_model(monkeypatch, ["A."])
    p = make(client)
    cid = events(client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "Q?"}))[0]["conversation"]["id"]
    assert client.patch(f"/api/conversations/{cid}", json={"title": "Positional encoding"}).json()["title"] == "Positional encoding"
    assert client.delete(f"/api/conversations/{cid}").status_code == 204
    assert client.get(f"/api/conversations/{cid}").status_code == 404


def test_answers_are_searchable(client, monkeypatch):
    fake_model(monkeypatch, ["The quaternion trick keeps rotations smooth."])
    p = make(client)
    events(client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "Q?"}))
    found = client.get("/api/search", params={"q": "quaternion"}).json()
    assert [r["paper"]["id"] for r in found] == [p["id"]] and "[quaternion]" in found[0]["snippet"]


def test_old_explanations_become_conversations_once(client):
    p = make(client)
    with db.connect() as conn:
        conn.execute("delete from settings where key = 'conversations_migrated'")
        conn.execute("insert into explanations (paper_id, passage, question, answer, mode) values (?, 'a passage', '', 'An answer.', 'simplify')", (p["id"],))
        conn.execute("insert into explanations (paper_id, passage, question, answer, mode) values (?, 'stuck', '', '', 'explain')", (p["id"],))
    db.init()
    db.init()  # a second start changes nothing
    convs = store.list_for(p["id"])
    assert len(convs) == 1 and convs[0]["title"] == "Simplify: a passage"
    msgs = store.get(convs[0]["id"])["messages"]
    assert msgs[0]["meta"]["attachments"] == [{"kind": "passage", "text": "a passage"}] and msgs[1]["content"] == "An answer."
