"""Answering the last message of a conversation, streamed as NDJSON lines for the page (see static/js/chat/stream.js).

The answer is saved however it ends: done, error (with what was written so far) or stopped (the reader pressed Stop
or left). An empty answer is an error. Suggested follow-ups at the end of the answer are taken out of the text and
kept with the message.
"""
import json
import re
from collections.abc import Iterator

from papers import db, index, library, llm
from papers.ai.streaming import Thinking, guarded
from papers.chat import store

FOLLOWUPS = re.compile(r"```followups\s*\n(.*?)(?:```|$)", re.S)
NO_ANSWER = "No answer came back from the model. Try again, or choose another model in Settings."


def split_followups(text: str) -> tuple[str, list[str]]:
    """The answer without its ```followups block, and the questions in it."""
    m = FOLLOWUPS.search(text)
    if not m:
        return text.strip(), []
    questions = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", q).strip() for q in m.group(1).splitlines()]
    return (text[:m.start()] + text[m.end():]).strip(), [q for q in questions if q][:3]


def line(**event) -> str:
    return json.dumps(event) + "\n"


def turns(conversation: dict) -> list[dict]:
    return [{"role": m["role"], "kind": m["kind"], "content": m["content"], "attachments": m["meta"].get("attachments", [])}
            for m in conversation["messages"] if m["role"] == "user" or m["status"] == "done"]


def reply(conversation_id: int, paper: dict) -> Iterator[str]:
    """Stream the answer to the conversation's last message, then save it."""
    conversation = store.get(conversation_id)
    asked = conversation["messages"][-1]
    language = db.setting("language")
    parts: list[str] = []
    thought: list[str] = []
    status, error = "done", ""
    stream = guarded(lambda: llm.conversation_stream(paper, turns(conversation), language=language))
    try:
        for piece in stream:
            if isinstance(piece, Thinking):
                thought.append(piece)
                yield line(type="thinking", thinking=piece)
            else:
                parts.append(piece)
                yield line(type="text", text=piece)
    except llm.AIError as e:
        status, error = "error", str(e)
    except GeneratorExit:  # Stop, or the reader left: keep what was written, marked as stopped
        status = "stopped"
        raise
    finally:
        stream.close()
        content, followups = split_followups("".join(parts))
        if status == "done" and not content:
            status, error = "error", NO_ANSWER
        message = store.add_message(conversation_id, "assistant", kind=asked["kind"], content=content,
                                    thinking="".join(thought), status=status,
                                    meta={"followups": followups, **({"error": error} if error else {})})
        if status == "done":
            index.index_paper(paper)
            library.sync_paper(paper["id"])
    if status == "done":
        yield line(type="done", message=message)
    else:
        yield line(type="error", error=error, message=message)
