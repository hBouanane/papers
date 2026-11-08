"""Goals (stored as "topics"): what you're working on, papers found for it, and BibTeX exports."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from papers import bibtex, db, library, llm, scholar
from papers.store import get_paper

router = APIRouter(prefix="/api", tags=["goals"])


class TopicIn(BaseModel):
    goal: str


@router.post("/topics")
def create_topic(body: TopicIn):
    with db.connect() as conn:
        cur = conn.execute("insert into topics (goal) values (?)", (body.goal,))
        return dict(conn.execute("select * from topics where id = ?", (cur.lastrowid,)).fetchone())


@router.get("/topics")
def list_topics():
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("select * from topics order by id desc")]


@router.get("/topics/{topic_id}/search")
def search_topic(topic_id: int):
    """Papers for a goal: the AI turns it into a few search queries (or the goal itself is the query)."""
    with db.connect() as conn:
        topic = conn.execute("select * from topics where id = ?", (topic_id,)).fetchone()
    if not topic:
        raise HTTPException(404, "Topic not found")
    try:
        queries = llm.search_queries(topic["goal"])
    except Exception:
        queries = [topic["goal"]]
    seen, found = set(), []
    for query in queries:
        for p in scholar.search(query, limit=10):
            if p["external_id"] not in seen:
                seen.add(p["external_id"])
                found.append(p)
    return found


@router.get("/papers/{paper_id}/bibtex", response_class=PlainTextResponse)
def paper_bibtex(paper_id: int):
    return bibtex.entry(get_paper(paper_id))


@router.get("/bibtex")
def bibtex_file(topic_id: int | None = None):
    """A .bib file of the whole library, or of one goal."""
    with db.connect() as conn:
        if topic_id is None:
            rows, name = conn.execute("select * from papers order by year, title").fetchall(), "library"
        else:
            rows = conn.execute("select * from papers where topic_id = ? order by year, title", (topic_id,)).fetchall()
            goal = conn.execute("select goal from topics where id = ?", (topic_id,)).fetchone()
            name = library.safe_name(goal["goal"]) if goal else "goal"
    return PlainTextResponse("\n".join(bibtex.entry(dict(r)) for r in rows),
                             headers={"Content-Disposition": f'attachment; filename="{name}.bib"'})
