"""Conversations about a paper: list them (History), open one, send a message (the answer streams back), retry,
rename, delete. Selecting text and pressing Explain, Simplify or Translate starts a new conversation."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator

from papers import db
from papers.chat import answer, store
from papers.store import get_paper

router = APIRouter(prefix="/api", tags=["chat"])
STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class Attachment(BaseModel):
    kind: Literal["passage"] = "passage"
    text: str = Field(min_length=1, max_length=20000)
    label: str = ""  # where it's from, e.g. "Page 4" or "§3.4"


class MessageIn(BaseModel):
    kind: Literal["ask", "explain", "simplify", "translate"] = "ask"
    depth: Literal["quick", "deep"] = "quick"  # deep: the agent uses tools while it answers
    content: str = Field("", max_length=8000)
    attachments: list[Attachment] = []

    @model_validator(mode="after")
    def has_something(self):
        self.content = self.content.strip()
        if not self.content and not self.attachments:
            raise ValueError("Write a question or attach a passage.")
        return self


class RenameIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


def conversation_or_404(conversation_id: int) -> dict:
    c = store.get(conversation_id)
    if not c:
        raise HTTPException(404, "Conversation not found")
    return c


def check_language(body: MessageIn) -> None:
    if body.kind == "translate" and not db.setting("language"):
        raise HTTPException(400, "Set your language in Settings first, so the AI knows what to translate into.")


def send(conversation: dict, body: MessageIn, first: dict | None = None) -> StreamingResponse:
    """Save the reader's message, then stream the answer (after a line with the saved message)."""
    paper = get_paper(conversation["paper_id"])
    mine = store.add_message(conversation["id"], "user", kind=body.kind, content=body.content,
                             meta={"attachments": [a.model_dump() for a in body.attachments], "depth": body.depth})

    def lines():
        if first:
            yield answer.line(type="conversation", conversation=first)
        yield answer.line(type="user", message=mine)
        yield from answer.reply(conversation["id"], paper)

    return StreamingResponse(lines(), media_type="application/x-ndjson", headers=STREAM_HEADERS)


@router.get("/papers/{paper_id}/conversations")
def list_conversations(paper_id: int):
    get_paper(paper_id)
    return store.list_for(paper_id)


@router.post("/papers/{paper_id}/conversations/start")
def start_conversation(paper_id: int, body: MessageIn):
    """A new conversation with this first message; streams {"conversation"}, {"user"}, then the answer."""
    get_paper(paper_id)
    check_language(body)
    c = store.create(paper_id)
    return send(c, body, first={"id": c["id"], "paper_id": paper_id})


@router.get("/conversations/{conversation_id}")
def read_conversation(conversation_id: int):
    return conversation_or_404(conversation_id)


@router.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: int, body: MessageIn):
    c = conversation_or_404(conversation_id)
    check_language(body)
    return send(c, body)


@router.post("/conversations/{conversation_id}/retry")
def retry(conversation_id: int):
    """Answer the last message again: the answer that failed (or that you want redone) is replaced."""
    c = conversation_or_404(conversation_id)
    while c["messages"] and c["messages"][-1]["role"] == "assistant":
        store.delete_message(c["messages"].pop()["id"])
    if not c["messages"]:
        raise HTTPException(400, "Nothing to answer.")
    paper = get_paper(c["paper_id"])
    return StreamingResponse(answer.reply(conversation_id, paper), media_type="application/x-ndjson", headers=STREAM_HEADERS)


@router.patch("/conversations/{conversation_id}")
def rename(conversation_id: int, body: RenameIn):
    conversation_or_404(conversation_id)
    store.rename(conversation_id, body.title)
    return store.get(conversation_id)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete(conversation_id: int):
    c = conversation_or_404(conversation_id)
    store.delete(conversation_id)
    from papers import index, library
    paper = get_paper(c["paper_id"])
    index.index_paper(paper)
    library.sync_paper(paper["id"])
    return Response(status_code=204)


class UndoIn(BaseModel):
    index: int = Field(ge=0)


@router.post("/messages/{message_id}/undo")
def undo(message_id: int, body: UndoIn):
    """Undo something the AI did in Deep mode (a note, a highlight, a word, a paper it added)."""
    import json

    from papers import notes as notes_db
    from papers.routes import notes as notes_routes
    from papers.routes.papers import delete_paper
    from papers.store import update_paper
    m = store.get_message(message_id)
    actions = (m or {}).get("meta", {}).get("actions") or []
    if not m or body.index >= len(actions):
        raise HTTPException(404, "Nothing to undo there")
    action = actions[body.index]
    if action.get("undone"):
        return m
    kind, paper_id = action.get("kind"), action.get("paper_id")
    if kind in ("note", "highlight") and notes_db.get(action["id"]):
        notes_db.delete(action["id"])
        notes_routes.notes_changed(paper_id)
    elif kind == "word":
        paper = get_paper(paper_id)
        words = [w for w in paper["glossary"] or [] if w["term"].lower() != action["term"].lower()]
        update_paper(paper_id, glossary=json.dumps(words))
    elif kind == "paper":
        try:
            delete_paper(action["id"])
        except HTTPException:
            pass  # already deleted
    action["undone"] = True
    store.set_meta(message_id, m["meta"])
    return store.get_message(message_id)
