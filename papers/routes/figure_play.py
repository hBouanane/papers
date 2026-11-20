"""The figure quiz, two figures side by side, and a goal's idea map (papers/figure_parts.py)."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from papers import db, figure_parts, figures
from papers.store import get_paper

router = APIRouter(prefix="/api", tags=["figures"])


def _parts(paper_id: int, kind: str, number: int) -> list[dict]:
    try:
        return figure_parts.parts(paper_id, kind, number)
    except figure_parts.NoParts as e:
        raise HTTPException(409, str(e))


@router.get("/papers/{paper_id}/figures/{kind}-{number}/parts")
def figure_parts_route(paper_id: int, kind: Literal["figure", "table"], number: int):
    """A figure's main parts as boxes (asked of the AI the first time, then kept)."""
    get_paper(paper_id)
    return {"parts": _parts(paper_id, kind, number)}


@router.get("/figure-quiz")
def figure_quiz(skip: str = ""):
    """A figure from a paper you're reading or have read, with its parts to find. 404 when there is none yet."""
    try:
        picked = figure_parts.pick_for_quiz(skip)
    except figure_parts.NoParts as e:
        raise HTTPException(409, str(e))
    if not picked:
        raise HTTPException(404, "No figures to be quizzed on yet: open a paper with figures and start reading it.")
    return picked


class Side(BaseModel):
    paper_id: int
    number: int
    kind: Literal["figure", "table"] = "figure"


class CompareIn(BaseModel):
    first: Side
    second: Side


@router.post("/figures/compare")
def compare_figures(body: CompareIn):
    """Two figures with their parts, and which parts are the same thing."""
    sides = []
    for s in (body.first, body.second):
        paper = get_paper(s.paper_id)
        f = next((x for x in figures.for_paper(s.paper_id) if x["kind"] == s.kind and x["number"] == s.number), None)
        if not f:
            raise HTTPException(404, f"{s.kind.capitalize()} {s.number} isn't in “{paper['title']}”.")
        sides.append({"paper_id": s.paper_id, "title": paper["title"], "kind": s.kind, "number": s.number,
                      "caption": f["caption"], "page": f["page"], "parts": _parts(s.paper_id, s.kind, s.number),
                      "url": f"/api/papers/{s.paper_id}/figures/{figures.image_name(s.kind, s.number)}"})
    return {"sides": sides, "pairs": figure_parts.match(*sides)}


@router.get("/topics/{topic_id}/idea-map")
def read_idea_map(topic_id: int):
    return figure_parts.kept_map(topic_id) or {}


@router.post("/topics/{topic_id}/idea-map")
def make_idea_map(topic_id: int):
    """The main ideas across the goal's papers and which builds on which."""
    with db.connect() as conn:
        topic = conn.execute("select * from topics where id = ?", (topic_id,)).fetchone()
        rows = conn.execute("select id, title, year, abstract, json_extract(skim, '$.tldr') as tldr,"
                            " json_extract(skim, '$.key_idea') as key_idea from papers where topic_id = ?"
                            " and coalesce(archived, 0) = 0 order by year", (topic_id,)).fetchall()
    if not topic:
        raise HTTPException(404, "Goal not found")
    papers = [dict(r) for r in rows][:20]
    if len(papers) < 2:
        raise HTTPException(400, "An idea map needs at least two papers in the goal.")
    return figure_parts.make_map(topic_id, topic["goal"], papers)
