import json
import re
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from app import db, index, llm, pdf, scholar


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    yield


app = FastAPI(title="Papers", lifespan=lifespan)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"  # pick up UI changes without a hard refresh
    return response


@app.exception_handler(llm.AIError)
def ai_error(_: Request, exc: llm.AIError):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(httpx.HTTPError)
def upstream_error(_: Request, exc: httpx.HTTPError):
    return JSONResponse({"detail": f"Semantic Scholar request failed: {exc}"}, status_code=502)


class TopicIn(BaseModel):
    goal: str


class PaperEdit(BaseModel):
    title: str | None = Field(None, min_length=1)
    authors: str | None = None
    year: int | None = None
    topic_id: int | None = None

    @field_validator("title", "authors", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


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
    paper["has_pdf"] = db.pdf_path(paper_id).exists()
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


def save_pdf(paper_id: int, data: bytes):
    path = db.pdf_path(paper_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def read_pdf(data: bytes) -> str:
    if not pdf.is_pdf(data):
        raise HTTPException(400, "That file isn't a PDF. Choose a .pdf file.")
    try:
        return pdf.extract_text(data)
    except Exception:
        return ""  # unreadable text layer (e.g. scanned); the PDF can still be viewed


def describe_pdf(data: bytes, text: str, filename: str | None) -> dict:
    """Title and friends for an uploaded PDF, from the most to the least reliable source."""
    for identifier in pdf.find_ids(text):
        if found := scholar.lookup(identifier):
            return {k: v for k, v in found.items() if k != "pdf_url"}
    if text:
        try:
            if meta := {k: v for k, v in llm.paper_metadata(text[:3000]).items() if v}:
                return meta
        except llm.AIError:
            pass  # no AI configured: fall back to the layout
    title = pdf.title_from_spans(pdf.first_page_spans(data))
    fallback = (filename or "Untitled paper").removesuffix(".pdf")
    return {"title": title or pdf.guess_title(pdf.metadata(data), text, fallback)}


def insert_paper(fields: dict) -> int:
    with db.connect() as conn:
        cur = conn.execute(
            f"insert into papers ({', '.join(fields)}) values ({', '.join('?' * len(fields))})",
            tuple(fields.values()),
        )
    return cur.lastrowid


@app.post("/api/papers")
def create_paper(body: PaperIn):
    if not body.external_id and not body.pdf_url:
        # A reference read from a PDF: find the real paper so it gets an abstract, PDF and references.
        if match := scholar.resolve(body.title):
            body = body.model_copy(update={k: v for k, v in match.items() if v})
    data = b""
    if body.pdf_url:
        try:
            data = scholar.fetch_pdf(body.pdf_url)
        except Exception:
            pass  # user can upload the PDF instead
    text = pdf.extract_text(data) if pdf.is_pdf(data) else ""
    paper_id = insert_paper({**body.model_dump(), "text": text})
    if pdf.is_pdf(data):
        save_pdf(paper_id, data)
    return get_paper(paper_id)


@app.post("/api/papers/upload")
async def upload_paper(file: UploadFile, topic_id: int | None = Form(None)):
    data = await file.read()
    text = read_pdf(data)
    paper_id = insert_paper({**describe_pdf(data, text, file.filename), "topic_id": topic_id, "text": text})
    save_pdf(paper_id, data)
    return get_paper(paper_id)


def resume_text(text: str, position: float) -> str:
    """The sentence where the reader stopped, trimmed for a preview."""
    at = int(position * len(text))
    dot = text.rfind(". ", 0, at + 1)
    start = dot + 2 if dot >= 0 else 0
    snippet = text[start:start + 180]
    return snippet if len(snippet) < 180 else snippet.rsplit(" ", 1)[0] + "…"


@app.get("/api/papers")
def list_papers(topic_id: int | None = None):
    cols = "id, topic_id, title, authors, year, external_id, status, progress, position, understanding, source_paper_id, updated_at, text"
    with db.connect() as conn:
        if topic_id is None:
            rows = conn.execute(f"select {cols} from papers order by updated_at desc")
        else:
            rows = conn.execute(f"select {cols} from papers where topic_id = ? order by updated_at desc", (topic_id,))
        papers = [dict(r) for r in rows]
    for p in papers:
        text = p.pop("text")
        p["resume_text"] = resume_text(text, p["position"]) if p["status"] == "reading" and text else ""
    return papers


@app.get("/api/papers/{paper_id}")
def read_paper(paper_id: int):
    return get_paper(paper_id)


@app.patch("/api/papers/{paper_id}")
def edit_paper(paper_id: int, body: PaperEdit):
    get_paper(paper_id)
    fields = body.model_dump(exclude_unset=True)
    return update_paper(paper_id, **fields) if fields else get_paper(paper_id)


@app.post("/api/papers/{paper_id}/pdf")
async def upload_pdf(paper_id: int, file: UploadFile):
    get_paper(paper_id)
    data = await file.read()
    text = read_pdf(data)
    save_pdf(paper_id, data)
    return update_paper(paper_id, text=text)


@app.get("/api/papers/{paper_id}/file")
def paper_file(paper_id: int):
    path = db.pdf_path(paper_id)
    if not path.exists():
        raise HTTPException(404, "No PDF stored for this paper")
    return FileResponse(path, media_type="application/pdf")


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


class ProgressIn(BaseModel):
    position: float


@app.put("/api/papers/{paper_id}/progress")
def save_progress(paper_id: int, body: ProgressIn):
    paper = get_paper(paper_id)
    position = min(max(body.position, 0.0), 1.0)
    return update_paper(
        paper_id,
        position=position,
        progress=max(paper["progress"], position),
        status="read" if paper["status"] == "read" else "reading",
    )


@app.post("/api/papers/{paper_id}/finish")
def finish_paper(paper_id: int):
    paper = get_paper(paper_id)
    questions = llm.quiz(paper)
    index.index_paper(paper)
    return update_paper(paper_id, status="read", progress=1.0, quiz=json.dumps(questions))


class RecallIn(BaseModel):
    idea: str


@app.post("/api/recall")
def recall(body: RecallIn):
    cands = index.candidates(body.idea)
    if not cands:
        return []
    out = []
    with db.connect() as conn:
        for m in llm.recall(body.idea, cands):
            row = conn.execute(
                "select id, title, authors, year, status from papers where id = ?", (m["paper_id"],)
            ).fetchone()
            if row:
                out.append({"paper": dict(row), "reason": m["reason"]})
    return out


@app.get("/api/papers/{paper_id}/references")
def paper_references(paper_id: int):
    paper = get_paper(paper_id)
    refs = None
    if paper["external_id"]:
        try:
            refs = scholar.references(paper["external_id"])
        except httpx.HTTPError:
            if not paper["text"]:
                raise
    if refs is None:
        if not paper["text"]:
            raise HTTPException(400, "This paper has no text to read references from. Upload its PDF.")
        if paper["refs"] is None:
            paper["refs"] = llm.extract_references(references_section(paper["text"]))
            update_paper(paper_id, refs=json.dumps(paper["refs"]))
        refs = [{**r, "external_id": ""} for r in paper["refs"]]
    with db.connect() as conn:
        rows = conn.execute("select id, external_id, title from papers").fetchall()
    by_id = {r["external_id"]: r["id"] for r in rows if r["external_id"]}
    by_title = {scholar.norm_title(r["title"]): r["id"] for r in rows}
    return [{**r, "library_id": by_id.get(r["external_id"]) or by_title.get(scholar.norm_title(r["title"]))}
            for r in refs]


def references_section(text: str) -> str:
    """The bibliography at the end of a paper (or its tail if there is no heading)."""
    heads = list(re.finditer(r"(?m)^(references|bibliography)\s*$", text, re.IGNORECASE))
    section = text[heads[-1].start():] if heads else text[-15000:]
    return section[:40000]


@app.get("/api/papers/{paper_id}/chain")
def paper_chain(paper_id: int):
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


mimetypes.add_type("text/javascript", ".js")  # Windows registry can map .js to text/plain
app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "static", html=True), name="static")
