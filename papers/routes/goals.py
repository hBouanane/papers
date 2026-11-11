"""Goals (stored as "topics"): what you're working on, papers found for it, and BibTeX exports."""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from papers import bibtex, db, library, llm, roadmap, scholar
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


@router.patch("/topics/{topic_id}")
def rename_topic(topic_id: int, body: TopicIn):
    goal = body.goal.strip()
    if not goal:
        raise HTTPException(400, "A goal needs a few words.")
    with db.connect() as conn:
        conn.execute("update topics set goal = ? where id = ?", (goal, topic_id))
        row = conn.execute("select * from topics where id = ?", (topic_id,)).fetchone()
    if not row:
        raise HTTPException(404, "This goal doesn't exist.")
    return dict(row)


@router.delete("/topics/{topic_id}")
def delete_topic(topic_id: int):
    """Remove a goal. Its papers stay in the library, in no goal; its roadmap goes with it."""
    with db.connect() as conn:
        if not conn.execute("select 1 from topics where id = ?", (topic_id,)).fetchone():
            raise HTTPException(404, "This goal doesn't exist.")
        kept = conn.execute("update papers set topic_id = null where topic_id = ?", (topic_id,)).rowcount
        conn.execute("delete from settings where key = ?", (f"roadmap:{topic_id}",))
        conn.execute("delete from topics where id = ?", (topic_id,))
    return {"papers_kept": kept}


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


# ---------- A reading roadmap: the best papers for the goal, in order ----------
class RoadmapAdd(BaseModel):
    papers: list[str]  # the external_id (or title) of each chosen paper


def topic_or_404(topic_id: int) -> dict:
    with db.connect() as conn:
        topic = conn.execute("select * from topics where id = ?", (topic_id,)).fetchone()
    if not topic:
        raise HTTPException(404, "Goal not found")
    return dict(topic)


@router.get("/topics/{topic_id}/roadmap")
def read_roadmap(topic_id: int):
    topic_or_404(topic_id)
    return roadmap.saved(topic_id)


@router.post("/topics/{topic_id}/roadmap")
def make_roadmap(topic_id: int):
    """Search for the goal and have the AI order the best papers into stages (takes a little while)."""
    topic = topic_or_404(topic_id)
    return roadmap.build(topic_id, topic["goal"])


@router.post("/topics/{topic_id}/roadmap/add")
def add_from_roadmap(topic_id: int, body: RoadmapAdd, background: BackgroundTasks):
    """Add the chosen papers to the goal now; their PDFs download in the background."""
    topic_or_404(topic_id)
    try:
        plan, to_fetch = roadmap.add(topic_id, body.papers)
    except ValueError as e:
        raise HTTPException(400, str(e))
    background.add_task(roadmap.fetch_pdfs, to_fetch)
    return {**plan, "added": len(to_fetch)}


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
