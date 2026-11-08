"""While reading a paper: how far you got, finishing it, its figures and tables, and its references and chain."""
import json
import re
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from papers import db, figures, llm, scholar
from papers.ingest import find_references
from papers.store import get_paper, update_paper

router = APIRouter(prefix="/api/papers/{paper_id}", tags=["reading"])

SLICES = 100  # a paper is tracked as 100 equal slices, each read or not
MAX_GAP = 3  # unread runs this short between read parts were read too (they slipped past mid-screen)


def fill_gaps(bits: str) -> str:
    return re.sub(rf"(?<=1)0{{1,{MAX_GAP}}}(?=1)", lambda m: "1" * len(m[0]), bits)


class ProgressIn(BaseModel):
    position: float
    slices: list[int] = []  # slices the reader actually spent time on
    mode: Literal["read", "skim"] = "read"


@router.put("/progress")
def save_progress(paper_id: int, body: ProgressIn):
    paper = get_paper(paper_id)
    if body.mode == "skim":
        return update_paper(paper_id, status="skimmed") if paper["status"] == "new" else paper
    bits = list(paper["read_slices"] or "0" * SLICES)
    for i in body.slices:
        if 0 <= i < SLICES:
            bits[i] = "1"
    bits = list(fill_gaps("".join(bits)))
    read = bits.count("1") / SLICES
    # Papers tracked the old way keep their percentage until real reading overtakes it.
    progress = read if paper["read_slices"] else max(paper["progress"], read)
    return update_paper(
        paper_id,
        position=min(max(body.position, 0.0), 1.0),
        progress=progress,
        read_slices="".join(bits),
        status="read" if paper["status"] == "read" else "reading",
    )


@router.post("/finish")
def finish_paper(paper_id: int):
    """Mark it read; its review questions are due right away, while it's fresh."""
    paper = get_paper(paper_id)
    questions = json.dumps(paper["quiz"]) if paper["quiz"] else None
    if not questions:
        try:
            questions = json.dumps(llm.quiz(paper))
        except llm.AIError:
            pass  # still mark it read; the quiz can be written later
    due = date.today().isoformat() if questions else None
    return update_paper(paper_id, status="read", progress=1.0, read_slices="1" * SLICES, quiz=questions, review_due=due)


@router.get("/figures")
def paper_figures(paper_id: int):
    """The figures and tables cut out of the paper's PDF, with their captions (worked out once, then kept)."""
    get_paper(paper_id)
    return [{**f, "url": f"/api/papers/{paper_id}/figures/{figures.image_name(f['kind'], f['number'])}"}
            for f in figures.for_paper(paper_id)]


@router.get("/figures/{kind}-{number}.png")
def paper_figure(paper_id: int, kind: Literal["figure", "table"], number: int):
    path = figures.folder(paper_id) / figures.image_name(kind, number)
    if not path.exists():
        raise HTTPException(404, "No such figure")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@router.get("/references")
def paper_references(paper_id: int):
    """The paper's references, each marked with its id when it's already in the library."""
    paper = get_paper(paper_id)
    refs = paper["refs"]
    if refs is None:
        refs = find_references(paper)
        update_paper(paper_id, refs=json.dumps(refs))
    with db.connect() as conn:
        rows = conn.execute("select id, external_id, title from papers").fetchall()
    by_id = {r["external_id"]: r["id"] for r in rows if r["external_id"]}
    by_title = {scholar.norm_title(r["title"]): r["id"] for r in rows}
    return [{**r, "library_id": by_id.get(r["external_id"]) or by_title.get(scholar.norm_title(r["title"]))}
            for r in refs]


@router.get("/chain")
def paper_chain(paper_id: int):
    """The papers that led to this one (oldest first) and the ones it led to."""
    cols = "id, title, status, source_paper_id"
    path, current = [], paper_id
    with db.connect() as conn:
        while current and current not in {p["id"] for p in path}:
            row = conn.execute(f"select {cols} from papers where id = ?", (current,)).fetchone()
            if not row:
                break
            path.insert(0, dict(row))
            current = row["source_paper_id"]
        children = [dict(r) for r in conn.execute(f"select {cols} from papers where source_paper_id = ?", (paper_id,))]
    if not path:
        raise HTTPException(404, "Paper not found")
    return {"path": path, "children": children}
