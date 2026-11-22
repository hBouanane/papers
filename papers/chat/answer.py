"""Answering the last message of a conversation, streamed as NDJSON lines for the page (see static/js/chat/stream.js).

The answer is saved however it ends: done, error (with what was written so far) or stopped (the reader pressed Stop
or left). An empty answer is an error. Suggested follow-ups at the end of the answer are taken out of the text and
kept with the message.
"""
import json
import re
from collections.abc import Iterator

from papers import db, figures, index, library, llm
from papers.agent import loop as agent
from papers.agent import tools
from papers.ai import providers
from papers.ai.errors import plain
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


FIGURE = re.compile(r"```figure[ \t]*\n(.*?)```", re.S)


CELL = re.compile(r"^([A-Ja-j])(10|[1-9])$")
MOST_BOXES = 6


def _area(box: dict) -> tuple[int, int, int, int] | None:
    """A box's cells as (col0, row0, col1, row1), or None when it names no real cell."""
    a, z = CELL.match(str(box.get("from", "")).strip()), CELL.match(str(box.get("to") or box.get("from", "")).strip())
    if not (a and z):
        return None
    cols = sorted(ord(m.group(1).upper()) - 65 for m in (a, z))
    rows = sorted(int(m.group(2)) - 1 for m in (a, z))
    return cols[0], rows[0], cols[1], rows[1]


def tidy_boxes(boxes: list) -> list:
    """Boxes that point at something: real cells, not most of the figure, no near-duplicates, at most six. A weak
    model draws one box around everything, or the same part three times."""
    return [b for _, b in _tidy_numbered(boxes)]


def _tidy_numbered(boxes: list) -> list[tuple[int, dict]]:
    """tidy_boxes, keeping each kept box's position in the model's list (pairs refer to boxes by number)."""
    kept, areas = [], []
    for i, b in enumerate(boxes if isinstance(boxes, list) else []):
        area = _area(b) if isinstance(b, dict) else None
        if not area:
            continue
        c0, r0, c1, r1 = area
        size = (c1 - c0 + 1) * (r1 - r0 + 1)
        if size > 70:  # more than 70 of the 100 cells: that's the whole figure, not a part of it
            continue
        same = any(max(0, min(c1, d1) - max(c0, d0) + 1) * max(0, min(r1, e1) - max(r0, e0) + 1) / max(size, (d1 - d0 + 1) * (e1 - e0 + 1)) > .8
                   for d0, e0, d1, e1 in areas)
        if same:
            continue
        kept.append((i, b))
        areas.append(area)
    return kept[:MOST_BOXES]


COMPARE = re.compile(r"```compare[ \t]*\n(.*?)```", re.S)
MOST_PAIRS = 6


def checked_compares(text: str, compared: set[tuple[int, int, str]]) -> str:
    """Keep a ```compare visual only when the model really put those two figures side by side with the tool in this
    answer; then tidy its boxes and keep only pairs whose two boxes survived, each box in one pair at most. Anything
    else is dropped: two figures matched from memory are worse than none."""
    def title_of(paper_id) -> str:
        try:
            with db.connect() as conn:
                row = conn.execute("select title from papers where id = ?", (int(paper_id),)).fetchone()
        except (TypeError, ValueError):
            return ""
        return row["title"] if row else ""

    def check(m: re.Match) -> str:
        try:
            spec = json.loads(m.group(1))
            left, right = spec["left"], spec["right"]
            key = (int(left["figure"]), int(right["figure"]), title_of(right.get("paper")))
        except (ValueError, KeyError, TypeError):
            return ""
        if key not in compared:
            return ""
        lefts, rights = _tidy_numbered(left.get("boxes")), _tidy_numbered(right.get("boxes"))
        new_left = {old + 1: new + 1 for new, (old, _) in enumerate(lefts)}
        new_right = {old + 1: new + 1 for new, (old, _) in enumerate(rights)}
        pairs, used_left, used_right = [], set(), set()
        for p in spec.get("pairs") or []:
            try:
                a, b = new_left.get(int(p["left"])), new_right.get(int(p["right"]))
            except (KeyError, TypeError, ValueError):
                continue
            if a and b and a not in used_left and b not in used_right:
                used_left.add(a)
                used_right.add(b)
                pairs.append({"left": a, "right": b, "same": str(p.get("same") or "").strip()[:80]})
        out = {"left": {"figure": key[0], "boxes": [b for _, b in lefts]},
               "right": {"paper": int(right["paper"]), "figure": key[1], "boxes": [b for _, b in rights]},
               "pairs": pairs[:MOST_PAIRS]}
        return "```compare\n" + json.dumps(out) + "\n```"
    return COMPARE.sub(check, text)


def only_seen_boxes(text: str, seen: set[tuple[str, int]]) -> str:
    """Take the "look here" boxes off any figure the model didn't look at while answering: placed from memory or
    from the caption they land in the wrong place, which is worse than no box."""
    def checked(m: re.Match) -> str:
        try:
            spec = json.loads(m.group(1))
        except ValueError:
            return m.group(0)
        if not isinstance(spec, dict) or "boxes" not in spec:
            return m.group(0)
        kind = "table" if spec.get("table") else "figure"
        try:
            number = int(spec.get(kind))
        except (TypeError, ValueError):
            number = -1
        if (kind, number) in seen:
            spec["boxes"] = tidy_boxes(spec["boxes"])
        else:
            spec.pop("boxes")
        return "```figure\n" + json.dumps(spec) + "\n```"
    return FIGURE.sub(checked, text)


FIGURE_NAMED = re.compile(r"\b(fig(?:ure)?|tab(?:le)?)\.?\s*(\d+)\b", re.I)


def about_a_figure(asked: dict, known: list[dict]) -> bool:
    """Whether the reader asks about one of the paper's figures or tables ("in Figure 1", "Fig. 2", a pointed-at
    figure). Answering that well needs the image, which only Deep mode's look_at_figure gives the model, so such
    a question is answered in Deep mode even when Quick was chosen. Not for Codex, which has no tools."""
    from papers.ai import capabilities
    if providers.backend() == "codex" or not capabilities.allows("tools"):
        return False
    words = " ".join([asked.get("content") or "", *[a.get("label") or "" for a in asked["meta"].get("attachments", [])]])
    have = {(f["kind"], int(f["number"])) for f in known}
    return any(("table" if m.group(1).lower().startswith("tab") else "figure", int(m.group(2))) in have
               for m in FIGURE_NAMED.finditer(words))


TOOL_TEXT = [
    re.compile(r"<tool_call>.*?(</tool_call>|$)", re.S),  # Qwen, Hermes
    re.compile(r"<\|?(?:tool_calls?|function_calls?)[^>]*>.*?(<\|?/?(?:tool_calls?|function_calls?)[^>]*>|$)", re.S),
    re.compile(r"<function=\w+>.*?(</function>|$)", re.S),  # Llama
]


def strip_tool_text(text: str) -> tuple[str, bool]:
    """Some models write their tool calls into the answer as text instead of making them, so the reader would see raw
    JSON. Take those out; say whether anything was taken out."""
    names = "|".join(re.escape(n) for n in tools.TOOLS)
    json_call = re.compile(r"(?:```(?:json)?\s*)?\{\s*\"(?:name|tool|function)\"\s*:\s*\"(?:" + names
                           + r")\".*?\}\s*\}?\s*(?:```)?", re.S)
    out = text
    for pattern in [*TOOL_TEXT, json_call]:
        out = pattern.sub("", out)
    return out.strip(), out.strip() != text.strip()


TOOLS_AS_TEXT = ("This model wrote its steps as text instead of using the app's tools, so Deep mode doesn't work with it. "
                 "Ask again in Quick mode, or pick another model in Settings.")


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
    status, error, technical = "done", "", ""
    known = figures.known(paper["id"])
    model = providers.describe()  # shown under the answer: "Written by ..."
    # Deep mode: the agent uses tools while it answers. A question about a figure goes there too, to see it.
    deep = asked["meta"].get("depth") == "deep" or about_a_figure(asked, known)
    steps: list[dict] = []
    actions: list[dict] = []
    if deep:
        stream = guarded(lambda: agent.run(paper, turns(conversation), language=language, figures=known))
    else:
        stream = guarded(lambda: llm.conversation_stream(paper, turns(conversation), language=language, figures=known))
    try:
        for piece in stream:
            if isinstance(piece, agent.Action):
                actions.append(piece.data)
                yield line(type="action", action=piece.data)
            elif isinstance(piece, agent.Step):
                if piece.state == "done":
                    steps.append({"name": piece.name, "summary": piece.summary})
                yield line(type="tool", tool=piece.event())
            elif isinstance(piece, Thinking):
                thought.append(piece)
                yield line(type="thinking", thinking=piece)
            else:
                parts.append(piece)
                yield line(type="text", text=piece)
    except llm.AIError as e:
        status, error, technical = "error", plain(str(e)), str(e)
    except GeneratorExit:  # Stop, or the reader left: keep what was written, marked as stopped
        status = "stopped"
        raise
    finally:
        stream.close()
        content, followups = split_followups("".join(parts))
        content = only_seen_boxes(content, tools.seen(steps))
        content = checked_compares(content, tools.compared(steps))
        if deep:
            content, had_tool_text = strip_tool_text(content)
        else:
            had_tool_text = False
        if status == "done" and not content:
            status, error = "error", TOOLS_AS_TEXT if had_tool_text else NO_ANSWER
        message = store.add_message(conversation_id, "assistant", kind=asked["kind"], content=content,
                                    thinking="".join(thought), status=status,
                                    meta={"followups": followups, "model": model, **({"steps": steps} if deep else {}),
                                          **({"shortened": True} if llm.shortened(paper) else {}),
                                          **({"actions": actions} if actions else {}),
                                          **({"error": error} if error else {}),
                                          **({"error_details": technical} if technical and technical != error else {})})
        if status == "done":
            index.index_paper(paper)
            library.sync_paper(paper["id"])
    if status == "done":
        yield line(type="done", message=message)
    else:
        yield line(type="error", error=error, message=message)
