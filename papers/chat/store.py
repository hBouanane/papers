"""Conversations about a paper: each Explain, Simplify, Translate or question starts one, and follow-ups continue it.

A conversation is a list of messages. A message you send can carry attachments: passages you selected (or, later,
figures and tables), shown as quotes and given to the model with the message. The model's messages keep their
thinking, their status (done, error, stopped) and extras in `meta` (suggested follow-ups, and later the agent's
steps and actions).
"""
import json
import re

from papers import db

SCHEMA = """
create table if not exists conversations (
    id integer primary key,
    paper_id integer references papers(id),
    title text default '',
    created_at text default current_timestamp,
    updated_at text default current_timestamp
);
create table if not exists messages (
    id integer primary key,
    conversation_id integer references conversations(id),
    role text not null,             -- 'user' or 'assistant'
    kind text default 'ask',        -- what was asked: ask, explain, simplify, translate
    content text default '',
    thinking text default '',
    status text default 'done',     -- done, error, stopped
    meta text default '{}',         -- attachments, follow-ups, steps, actions
    created_at text default current_timestamp
);
create index if not exists messages_by_conversation on messages(conversation_id, id);
"""

KINDS = ("ask", "explain", "simplify", "translate")
ACTION = {"explain": "Explain", "simplify": "Simplify", "translate": "Translate"}


def init(conn) -> None:
    conn.executescript(SCHEMA)
    # Explanations asked before conversations existed become conversations of two messages (once).
    if conn.execute("select 1 from settings where key = 'conversations_migrated'").fetchone():
        return
    for e in conn.execute("select * from explanations where trim(coalesce(answer, '')) != '' order by id").fetchall():
        e = dict(e)
        attachments = [{"kind": "passage", "text": e["passage"]}] if e["passage"] else []
        cid = conn.execute("insert into conversations (paper_id, title, created_at, updated_at) values (?, ?, ?, ?)",
                           (e["paper_id"], title_for(e["question"], attachments, e.get("mode") or "explain"),
                            e["created_at"], e["created_at"])).lastrowid
        conn.execute("insert into messages (conversation_id, role, kind, content, meta, created_at) values (?, 'user', ?, ?, ?, ?)",
                     (cid, e.get("mode") or "explain", e["question"] or "", json.dumps({"attachments": attachments}), e["created_at"]))
        conn.execute("insert into messages (conversation_id, role, kind, content, created_at) values (?, 'assistant', ?, ?, ?)",
                     (cid, e.get("mode") or "explain", e["answer"], e["created_at"]))
    conn.execute("insert into settings (key, value) values ('conversations_migrated', '1')")


def title_for(question: str, attachments: list[dict], kind: str) -> str:
    """A short title from what was asked: the question, or the start of the passage."""
    source = (question or "").strip() or next((a.get("text", "") for a in attachments if a.get("text")), "")
    words = re.sub(r"\s+", " ", source).strip()
    title = words if len(words) <= 60 else words[:60].rsplit(" ", 1)[0] + "…"
    if not (question or "").strip() and kind in ACTION and title:
        title = f"{ACTION[kind]}: {title}"
    return title or "New conversation"


def _message(row) -> dict:
    m = dict(row)
    m["meta"] = json.loads(m.get("meta") or "{}")
    return m


# ---------- Reading ----------
def list_for(paper_id: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "select c.*, (select count(*) from messages m where m.conversation_id = c.id) as messages,"
            " (select content from messages m where m.conversation_id = c.id and m.role = 'assistant'"
            "  and m.status = 'done' order by m.id desc limit 1) as last_answer"
            " from conversations c where c.paper_id = ? order by c.updated_at desc, c.id desc", (paper_id,)).fetchall()
    out = []
    for r in rows:
        c = dict(r)
        c["preview"] = re.sub(r"\s+", " ", re.sub(r"[#*_`>]|```\w*", "", c.pop("last_answer") or "")).strip()[:140]
        out.append(c)
    return out


def get(conversation_id: int) -> dict | None:
    with db.connect() as conn:
        c = conn.execute("select * from conversations where id = ?", (conversation_id,)).fetchone()
        if not c:
            return None
        messages = [_message(r) for r in conn.execute(
            "select * from messages where conversation_id = ? order by id", (conversation_id,))]
    return {**dict(c), "messages": messages}


def answers_for(paper_id: int) -> list[dict]:
    """Every finished answer about the paper with what it answered ({passage, question, answer, mode}), oldest
    first: for search, Recall and the library folder's notes."""
    out = []
    with db.connect() as conn:
        for c in conn.execute("select id from conversations where paper_id = ? order by id", (paper_id,)).fetchall():
            asked = None
            for m in conn.execute("select * from messages where conversation_id = ? order by id", (c["id"],)).fetchall():
                m = _message(m)
                if m["role"] == "user":
                    asked = m
                elif asked and m["status"] == "done" and m["content"].strip():
                    passage = "\n\n".join(a.get("text", "") for a in asked["meta"].get("attachments", []) if a.get("text"))
                    out.append({"id": m["id"], "conversation_id": c["id"], "passage": passage, "question": asked["content"],
                                "answer": m["content"], "mode": asked["kind"], "created_at": m["created_at"]})
    return out


# ---------- Writing ----------
def create(paper_id: int, title: str = "") -> dict:
    with db.connect() as conn:
        cid = conn.execute("insert into conversations (paper_id, title) values (?, ?)", (paper_id, title)).lastrowid
    return get(cid)


def rename(conversation_id: int, title: str) -> None:
    with db.connect() as conn:
        conn.execute("update conversations set title = ? where id = ?", (title.strip()[:120], conversation_id))


def delete(conversation_id: int) -> None:
    with db.connect() as conn:
        conn.execute("delete from messages where conversation_id = ?", (conversation_id,))
        conn.execute("delete from conversations where id = ?", (conversation_id,))


def delete_for_paper(paper_id: int) -> None:
    with db.connect() as conn:
        conn.execute("delete from messages where conversation_id in (select id from conversations where paper_id = ?)", (paper_id,))
        conn.execute("delete from conversations where paper_id = ?", (paper_id,))


def add_message(conversation_id: int, role: str, kind: str = "ask", content: str = "", thinking: str = "",
                status: str = "done", meta: dict | None = None) -> dict:
    with db.connect() as conn:
        mid = conn.execute(
            "insert into messages (conversation_id, role, kind, content, thinking, status, meta) values (?, ?, ?, ?, ?, ?, ?)",
            (conversation_id, role, kind, content, thinking, status, json.dumps(meta or {}))).lastrowid
        conn.execute("update conversations set updated_at = current_timestamp where id = ?", (conversation_id,))
        # the first thing asked names the conversation
        c = conn.execute("select title from conversations where id = ?", (conversation_id,)).fetchone()
        if role == "user" and not (c["title"] or "").strip():
            conn.execute("update conversations set title = ? where id = ?",
                         (title_for(content, (meta or {}).get("attachments", []), kind), conversation_id))
        return _message(conn.execute("select * from messages where id = ?", (mid,)).fetchone())


def delete_message(message_id: int) -> None:
    with db.connect() as conn:
        conn.execute("delete from messages where id = ?", (message_id,))
