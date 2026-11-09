"""Your notes and highlights on a paper: a list of items in the paper's order.

A highlight keeps the quoted text, a colour and where it is (page and, for the PDF, the
rectangles it covers); it can carry a note. A plain note has text and a place in the paper.
The paper's `notes` column holds all of it as plain text, for search and recall.
"""
import json

from papers import db

COLORS = ("yellow", "green", "blue", "pink")


def _row(r) -> dict:
    d = dict(r)
    d["anchor"] = json.loads(d["anchor"]) if d.get("anchor") else None
    return d


def list_for(paper_id: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute("select * from notes where paper_id = ? order by position, id", (paper_id,)).fetchall()
    return [_row(r) for r in rows]


def get(note_id: int) -> dict | None:
    with db.connect() as conn:
        r = conn.execute("select * from notes where id = ?", (note_id,)).fetchone()
    return _row(r) if r else None


def add(paper_id: int, kind: str = "note", body: str = "", quote: str = "", color: str = "yellow",
        page: int | None = None, position: float = 0, anchor: dict | None = None, source: str = "") -> dict:
    with db.connect() as conn:
        cur = conn.execute(
            "insert into notes (paper_id, kind, body, quote, color, page, position, anchor, source) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (paper_id, kind, body, quote, color, page, position, json.dumps(anchor) if anchor else None, source))
    return get(cur.lastrowid)


def edit(note_id: int, **fields) -> dict:
    sets = ", ".join(f"{k} = ?" for k in fields)
    with db.connect() as conn:
        conn.execute(f"update notes set {sets}, updated_at = current_timestamp where id = ?", (*fields.values(), note_id))
    return get(note_id)


def delete(note_id: int) -> None:
    with db.connect() as conn:
        conn.execute("delete from notes where id = ?", (note_id,))


def as_text(items: list[dict]) -> str:
    """Everything as plain text (stored on the paper for search and recall)."""
    return "\n\n".join("\n".join(x for x in (i["quote"], i["body"]) if x) for i in items)


def as_markdown(items: list[dict]) -> str:
    """The list for the notes file: highlights as quotes with their page, notes as text."""
    blocks = []
    for i in items:
        lines = []
        if i["quote"]:
            where = f" (p. {i['page']})" if i.get("page") else ""
            quoted = i["quote"].splitlines() or [""]
            quoted[-1] += where
            lines += [f"> {line}" for line in quoted]
            if i["body"]:
                lines.append("")
        if i["body"]:
            lines.append(i["body"])
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
