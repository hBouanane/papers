"""The figure quiz (papers/figure_parts.py)."""
from typing import Literal

from fastapi import APIRouter, HTTPException

from papers import figure_parts
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


