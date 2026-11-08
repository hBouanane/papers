"""Finding things you've read: full-text search, and Recall ("which paper had this idea?")."""
from fastapi import APIRouter
from pydantic import BaseModel

from papers import db, index, llm

router = APIRouter(prefix="/api", tags=["recall"])


class RecallIn(BaseModel):
    idea: str


@router.get("/search")
def search_library(q: str = ""):
    return index.search(q)


@router.post("/recall")
def recall(body: RecallIn):
    cands = index.candidates(body.idea)
    if not cands:
        return []
    try:
        matches = llm.recall(body.idea, cands)
    except llm.AIError:  # no AI: plain keyword matches, with the passage that matched
        matches = [{"paper_id": c["id"], "reason": f"Matched: “{c['snippet']}”"} for c in cands if c["snippet"]]
    out = []
    with db.connect() as conn:
        for m in matches:
            row = conn.execute("select id, title, authors, year, status from papers where id = ?", (m["paper_id"],)).fetchone()
            if row:  # has_pdf: the card shows the paper's first page
                out.append({"paper": {**dict(row), "has_pdf": db.pdf_path(row["id"]).exists()}, "reason": m["reason"]})
    return out
