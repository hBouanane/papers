"""Reading and writing papers. Every change goes through `update_paper`/`insert_paper`, which also keep the
search index and the library folder up to date, so callers never have to remember to."""
import re

from fastapi import HTTPException

from papers import db, figures, index, library, pdf, scholar

PREPARING: set[int] = set()  # papers the AI is reading ahead of time right now (see ingest.prepare_paper)


def get_paper(paper_id: int) -> dict:
    """The paper with everything the pages need; 404 if there is none."""
    with db.connect() as conn:
        paper = db.row_to_dict(conn.execute("select * from papers where id = ?", (paper_id,)).fetchone())
    if not paper:
        raise HTTPException(404, "Paper not found")
    paper["has_pdf"] = db.pdf_path(paper_id).exists()
    paper["preparing"] = paper_id in PREPARING
    paper["main_end"] = main_text_end(paper["text"] or "")
    own = pdf.abstract_from(paper["text"] or "")
    paper["paper_abstract"], paper["abstract_from_paper"] = (own, True) if own else (paper["abstract"] or "", False)
    paper["can_fetch_pdf"] = not paper["has_pdf"] and pdf_source(paper) is not None
    return paper


def update_paper(paper_id: int, **fields) -> dict:
    sets = ", ".join(f"{k} = ?" for k in fields)
    with db.connect() as conn:
        conn.execute(f"update papers set {sets}, updated_at = current_timestamp where id = ?", (*fields.values(), paper_id))
    index.index_paper(get_paper(paper_id))
    library.sync_paper(paper_id)
    return get_paper(paper_id)


def insert_paper(fields: dict) -> int:
    with db.connect() as conn:
        cur = conn.execute(f"insert into papers ({', '.join(fields)}) values ({', '.join('?' * len(fields))})",
                           tuple(fields.values()))
    index.index_paper(get_paper(cur.lastrowid))
    library.sync_paper(cur.lastrowid)
    return cur.lastrowid


def save_pdf(paper_id: int, data: bytes) -> None:
    figures.forget(paper_id)  # cut out again from the new file
    path = db.pdf_path(paper_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")  # whole or not there: a cover drawn from a half-written file stays blank
    part.write_bytes(data)
    part.replace(path)
    library.sync_paper(paper_id)


def find_existing(meta: dict) -> int | None:
    """The paper already in the library with this id or title, if any."""
    with db.connect() as conn:
        rows = conn.execute("select id, external_id, title from papers").fetchall()
    return next((r["id"] for r in rows if (meta.get("external_id") and r["external_id"] == meta["external_id"])
                 or scholar.norm_title(r["title"]) == scholar.norm_title(meta["title"])), None)


def goal_of(paper: dict) -> str:
    with db.connect() as conn:
        row = conn.execute("select goal from topics where id = ?", (paper["topic_id"],)).fetchone()
    return row["goal"] if row else ""


def pdf_source(p: dict) -> str | None:
    """Where the original PDF can be downloaded from, if we know."""
    if p.get("pdf_url"):
        return p["pdf_url"]
    if (p.get("external_id") or "").startswith("arXiv:"):
        return f"https://arxiv.org/pdf/{p['external_id'][6:]}"
    if m := re.search(r"arxiv\.org/abs/(\S+)", p.get("url") or ""):
        return f"https://arxiv.org/pdf/{m[1]}"
    return None


def main_text_end(text: str) -> float:
    """Where the main text ends (the references start), as a fraction of the paper."""
    heads = list(re.finditer(r"(?m)^(\d+\s+)?(references|bibliography)\s*$", text, re.IGNORECASE))
    return heads[-1].start() / len(text) if heads and text else 1


def references_section(text: str) -> str:
    """The bibliography at the end of a paper (or its tail if there is no heading)."""
    heads = list(re.finditer(r"(?m)^(references|bibliography)\s*$", text, re.IGNORECASE))
    section = text[heads[-1].start():] if heads else text[-15000:]
    return section[:40000]


def ai_wrote(paper_id: int, *fields: str) -> None:
    """Remember which model wrote these parts of the paper (skim, glossary, quiz), for the paper page's note."""
    import json

    from papers.ai import providers
    with db.connect() as conn:
        row = conn.execute("select made_by from papers where id = ?", (paper_id,)).fetchone()
        made = json.loads(row["made_by"]) if row and row["made_by"] else {}
        made.update({f: providers.describe() for f in fields})
        conn.execute("update papers set made_by = ? where id = ?", (json.dumps(made), paper_id))
