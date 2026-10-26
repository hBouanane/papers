import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import BaseModel

from app import db, llm, pdf, scholar


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    yield


app = FastAPI(title="Papers", lifespan=lifespan)


class TopicIn(BaseModel):
    goal: str


class PaperIn(BaseModel):
    title: str
    topic_id: int | None = None
    authors: str = ""
    year: int | None = None
    abstract: str = ""
    url: str = ""
    pdf_url: str = ""
    external_id: str = ""
    source_paper_id: int | None = None


def get_paper(paper_id: int) -> dict:
    with db.connect() as conn:
        paper = db.row_to_dict(conn.execute("select * from papers where id = ?", (paper_id,)).fetchone())
    if not paper:
        raise HTTPException(404, "Paper not found")
    return paper


def update_paper(paper_id: int, **fields) -> dict:
    sets = ", ".join(f"{k} = ?" for k in fields)
    with db.connect() as conn:
        conn.execute(
            f"update papers set {sets}, updated_at = current_timestamp where id = ?",
            (*fields.values(), paper_id),
        )
    return get_paper(paper_id)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/topics")
def create_topic(body: TopicIn):
    with db.connect() as conn:
        cur = conn.execute("insert into topics (goal) values (?)", (body.goal,))
        return dict(conn.execute("select * from topics where id = ?", (cur.lastrowid,)).fetchone())


@app.get("/api/topics")
def list_topics():
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("select * from topics order by id desc")]


@app.get("/api/topics/{topic_id}/search")
def search_topic(topic_id: int):
    with db.connect() as conn:
        topic = conn.execute("select * from topics where id = ?", (topic_id,)).fetchone()
    if not topic:
        raise HTTPException(404, "Topic not found")
    seen, found = set(), []
    for query in llm.search_queries(topic["goal"]):
        for p in scholar.search(query, limit=10):
            if p["external_id"] not in seen:
                seen.add(p["external_id"])
                found.append(p)
    return found


@app.post("/api/papers")
def create_paper(body: PaperIn):
    text = ""
    if body.pdf_url:
        try:
            text = scholar.fetch_pdf_text(body.pdf_url)
        except Exception:
            pass  # user can upload the PDF instead
    fields = {**body.model_dump(), "text": text}
    with db.connect() as conn:
        cur = conn.execute(
            f"insert into papers ({', '.join(fields)}) values ({', '.join('?' * len(fields))})",
            tuple(fields.values()),
        )
    return get_paper(cur.lastrowid)


@app.get("/api/papers")
def list_papers(topic_id: int | None = None):
    cols = "id, topic_id, title, authors, year, status, progress, position, understanding, source_paper_id, updated_at"
    with db.connect() as conn:
        if topic_id is None:
            rows = conn.execute(f"select {cols} from papers order by updated_at desc")
        else:
            rows = conn.execute(f"select {cols} from papers where topic_id = ? order by updated_at desc", (topic_id,))
        return [dict(r) for r in rows]


@app.get("/api/papers/{paper_id}")
def read_paper(paper_id: int):
    return get_paper(paper_id)


@app.post("/api/papers/{paper_id}/pdf")
async def upload_pdf(paper_id: int, file: UploadFile):
    get_paper(paper_id)
    return update_paper(paper_id, text=pdf.extract_text(await file.read()))


class ExplainIn(BaseModel):
    passage: str
    question: str = ""


class AnswersIn(BaseModel):
    answers: list[str]


@app.post("/api/papers/{paper_id}/skim")
def skim_paper(paper_id: int):
    paper = get_paper(paper_id)
    result = llm.skim(paper)
    status = "skimmed" if paper["status"] == "new" else paper["status"]
    update_paper(paper_id, skim=json.dumps(result), status=status)
    return result


@app.post("/api/papers/{paper_id}/explain")
def explain_passage(paper_id: int, body: ExplainIn):
    return {"explanation": llm.explain(get_paper(paper_id), body.passage, body.question)}


@app.post("/api/papers/{paper_id}/quiz")
def make_quiz(paper_id: int):
    questions = llm.quiz(get_paper(paper_id))
    update_paper(paper_id, quiz=json.dumps(questions))
    return questions


@app.post("/api/papers/{paper_id}/quiz/grade")
def grade_quiz(paper_id: int, body: AnswersIn):
    paper = get_paper(paper_id)
    if not paper["quiz"]:
        raise HTTPException(400, "Generate a quiz first")
    result = llm.grade(paper, paper["quiz"], body.answers)
    update_paper(paper_id, understanding=result["score"])
    return result
