import asyncio
import json
from datetime import date, timedelta
import os
from typing import Literal
import re
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator

from app import bibtex, db, index, library, llm, notes, pdf, scholar


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    index.backfill()
    poll = float(os.environ.get("PAPERS_INBOX_POLL", "10"))
    watcher = asyncio.create_task(watch_inbox(poll)) if poll > 0 else None
    yield
    if watcher:
        watcher.cancel()


async def watch_inbox(every: float):
    while True:
        await asyncio.sleep(every)
        try:
            await asyncio.to_thread(import_inbox)
            await asyncio.to_thread(library.import_notes)
        except Exception as e:  # keep watching even if one import fails
            print(f"Inbox import failed: {e}")


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
    archived: bool | None = None

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
    paper["preparing"] = paper_id in PREPARING
    paper["main_end"] = main_text_end(paper["text"] or "")
    paper["can_fetch_pdf"] = not paper["has_pdf"] and pdf_source(paper) is not None
    return paper


def update_paper(paper_id: int, **fields) -> dict:
    sets = ", ".join(f"{k} = ?" for k in fields)
    with db.connect() as conn:
        conn.execute(
            f"update papers set {sets}, updated_at = current_timestamp where id = ?",
            (*fields.values(), paper_id),
        )
    index.index_paper(get_paper(paper_id))
    library.sync_paper(paper_id)
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
    library.sync_paper(paper_id)


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
    index.index_paper(get_paper(cur.lastrowid))
    library.sync_paper(cur.lastrowid)
    return cur.lastrowid


PREPARING: set[int] = set()  # papers Claude is reading ahead of time right now


def goal_of(paper: dict) -> str:
    with db.connect() as conn:
        row = conn.execute("select goal from topics where id = ?", (paper["topic_id"],)).fetchone()
    return row["goal"] if row else ""


def prepare_paper(paper_id: int):
    """Have Claude read a paper ahead of time: key points, vocabulary, review questions and references,
    each saved once, so nothing makes the reader wait later. Steps that fail are left for later."""
    if not llm.configured() or paper_id in PREPARING:
        return
    PREPARING.add(paper_id)
    try:
        steps = [
            ("skim", lambda p: p["text"] and json.dumps(llm.skim(p, goal=goal_of(p)))),
            ("glossary", lambda p: p["text"] and json.dumps(llm.glossary(p, language=setting("language")))),
            ("quiz", lambda p: p["text"] and json.dumps(llm.quiz(p))),
            ("refs", lambda p: (p["text"] or p["external_id"]) and json.dumps(find_references(p))),
        ]
        for field, make in steps:
            paper = get_paper(paper_id)
            if paper[field] is not None:
                continue
            try:
                if value := make(paper):
                    update_paper(paper_id, **{field: value})
            except (llm.AIError, httpx.HTTPError, HTTPException):
                pass
    finally:
        PREPARING.discard(paper_id)


def store_pdf_paper(data: bytes, text: str, fields: dict, topic_id: int | None) -> int:
    """Add a paper from a PDF, or attach the PDF to the matching paper already in the library."""
    existing = find_existing(fields)
    if existing is None:
        paper_id = insert_paper({**fields, "topic_id": topic_id, "text": text})
        save_pdf(paper_id, data)
        return paper_id
    paper = get_paper(existing)
    updates = {k: v for k, v in (("text", text), ("topic_id", topic_id)) if v and not paper[k]}
    if updates:
        update_paper(existing, **updates)
    if not paper["has_pdf"]:
        save_pdf(existing, data)
    return existing


@app.post("/api/papers")
def create_paper(body: PaperIn, background: BackgroundTasks):
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
    background.add_task(prepare_paper, paper_id)
    return get_paper(paper_id)


class LinkIn(BaseModel):
    link: str
    topic_id: int | None = None


def find_existing(meta: dict) -> int | None:
    with db.connect() as conn:
        rows = conn.execute("select id, external_id, title from papers").fetchall()
    return next((r["id"] for r in rows if (meta.get("external_id") and r["external_id"] == meta["external_id"])
                 or scholar.norm_title(r["title"]) == scholar.norm_title(meta["title"])), None)


@app.post("/api/papers/from-link")
def add_from_link(body: LinkIn, background: BackgroundTasks):
    if identifier := scholar.parse_link(body.link):
        meta = scholar.lookup(identifier)
        if not meta:
            raise HTTPException(404, "Couldn't find a paper for that link. Check it, or upload the PDF instead.")
        if existing := find_existing(meta):
            return get_paper(existing)
        return create_paper(PaperIn(**meta, topic_id=body.topic_id), background)
    url = body.link.strip()
    if not re.match(r"https?://", url):
        raise HTTPException(400, "Paste an arXiv, DOI or Semantic Scholar link, or a link to a PDF.")
    try:
        data = scholar.fetch_pdf(url)
    except httpx.HTTPError:
        raise HTTPException(400, "Couldn't download that link. Check it, or upload the PDF instead.")
    if not pdf.is_pdf(data):
        raise HTTPException(400, "That link isn't a paper. Paste an arXiv, DOI or Semantic Scholar link, or a link to a PDF.")
    text = read_pdf(data)
    fields = describe_pdf(data, text, url.rsplit("/", 1)[-1])
    paper_id = store_pdf_paper(data, text, {**fields, "url": url}, body.topic_id)
    background.add_task(prepare_paper, paper_id)
    return get_paper(paper_id)


@app.post("/api/papers/upload")
async def upload_paper(background: BackgroundTasks, file: UploadFile, topic_id: int | None = Form(None)):
    data = await file.read()
    text = read_pdf(data)
    paper_id = store_pdf_paper(data, text, describe_pdf(data, text, file.filename), topic_id)
    background.add_task(prepare_paper, paper_id)
    return get_paper(paper_id)


def resume_text(text: str, position: float) -> str:
    """The sentence where the reader stopped, trimmed for a preview."""
    at = int(position * len(text))
    dot = text.rfind(". ", 0, at + 1)
    start = dot + 2 if dot >= 0 else 0
    snippet = text[start:start + 180]
    return snippet if len(snippet) < 180 else snippet.rsplit(" ", 1)[0] + "…"


@app.get("/api/papers")
def list_papers(topic_id: int | None = None, archived: bool = False):
    """Papers in the library (archived ones only when asked for)."""
    cols = ("id, topic_id, title, authors, year, external_id, status, progress, position, understanding,"
            " source_paper_id, read_slices, archived, updated_at, text")
    where, args = ["coalesce(archived, 0) = ?"], [int(archived)]
    if topic_id is not None:
        where.append("topic_id = ?")
        args.append(topic_id)
    with db.connect() as conn:
        rows = conn.execute(f"select {cols} from papers where {' and '.join(where)} order by updated_at desc", args)
        papers = [dict(r) for r in rows]
    for p in papers:
        text = p.pop("text")
        p["resume_text"] = resume_text(text, p["position"]) if p["status"] == "reading" and text else ""
        p["has_pdf"] = db.pdf_path(p["id"]).exists()  # the Library draws its first page as the cover
    return papers


@app.get("/api/papers/{paper_id}")
def read_paper(paper_id: int):
    return get_paper(paper_id)


@app.delete("/api/papers/{paper_id}", status_code=204)
def delete_paper(paper_id: int):
    paper = get_paper(paper_id)
    library.remove(paper)
    index.remove(paper_id)
    db.pdf_path(paper_id).unlink(missing_ok=True)
    with db.connect() as conn:
        conn.execute("delete from explanations where paper_id = ?", (paper_id,))
        conn.execute("delete from notes where paper_id = ?", (paper_id,))
        conn.execute("update papers set source_paper_id = null where source_paper_id = ?", (paper_id,))
        conn.execute("delete from papers where id = ?", (paper_id,))
    if paper["source_paper_id"]:
        library.sync_paper(paper["source_paper_id"], follow_parent=False)  # drop it from "Led to"
    return Response(status_code=204)


@app.get("/api/papers/{paper_id}/bibtex", response_class=PlainTextResponse)
def paper_bibtex(paper_id: int):
    return bibtex.entry(get_paper(paper_id))


@app.get("/api/bibtex")
def bibtex_file(topic_id: int | None = None):
    with db.connect() as conn:
        if topic_id is None:
            rows, name = conn.execute("select * from papers order by year, title").fetchall(), "library"
        else:
            rows = conn.execute("select * from papers where topic_id = ? order by year, title", (topic_id,)).fetchall()
            goal = conn.execute("select goal from topics where id = ?", (topic_id,)).fetchone()
            name = library.safe_name(goal["goal"]) if goal else "goal"
    return PlainTextResponse("\n".join(bibtex.entry(dict(r)) for r in rows),
                             headers={"Content-Disposition": f'attachment; filename="{name}.bib"'})


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


def pdf_source(p: dict) -> str | None:
    """Where the original PDF can be downloaded from, if we know."""
    if p.get("pdf_url"):
        return p["pdf_url"]
    if (p.get("external_id") or "").startswith("arXiv:"):
        return f"https://arxiv.org/pdf/{p['external_id'][6:]}"
    if m := re.search(r"arxiv\.org/abs/(\S+)", p.get("url") or ""):
        return f"https://arxiv.org/pdf/{m[1]}"
    return None


@app.post("/api/papers/{paper_id}/prepare")
def prepare(paper_id: int, background: BackgroundTasks):
    """Fill in whatever Claude hasn't prepared yet for this paper (runs in the background)."""
    background.add_task(prepare_paper, paper_id)
    return get_paper(paper_id)


@app.post("/api/papers/{paper_id}/fetch-pdf")
def fetch_original_pdf(paper_id: int):
    """Download the original PDF for papers added before PDFs were kept."""
    paper = get_paper(paper_id)
    if paper["has_pdf"]:
        return paper
    if not (url := pdf_source(paper)):
        raise HTTPException(400, "No PDF link is known for this paper. Upload the PDF instead.")
    data = scholar.fetch_pdf(url)
    if not pdf.is_pdf(data):
        raise HTTPException(400, "That link didn't return a PDF. Upload the PDF instead.")
    save_pdf(paper_id, data)
    if not paper["text"]:
        update_paper(paper_id, text=read_pdf(data))
    return get_paper(paper_id)


@app.post("/api/papers/{paper_id}/glossary")
def make_glossary(paper_id: int):
    paper = get_paper(paper_id)
    if not paper["text"]:
        raise HTTPException(400, "This paper has no text yet. Upload its PDF first.")
    language = setting("language")
    words = llm.glossary(paper, language=language)
    update_paper(paper_id, glossary=json.dumps(words))
    return words


class WordIn(BaseModel):
    term: str = Field(min_length=1, max_length=80)
    context: str = ""


@app.post("/api/papers/{paper_id}/words")
def save_word(paper_id: int, body: WordIn):
    """Add a word the reader picked to this paper's vocabulary (explained in context)."""
    paper = get_paper(paper_id)
    words = paper["glossary"] or []
    if any(w["term"].lower() == body.term.strip().lower() for w in words):
        return words
    word = llm.define(paper, body.term.strip(), body.context.strip(), language=setting("language"))
    words = [*words, word]
    update_paper(paper_id, glossary=json.dumps(words))
    return words


@app.get("/api/papers/{paper_id}/file")
def paper_file(paper_id: int):
    path = db.pdf_path(paper_id)
    if not path.exists():
        raise HTTPException(404, "No PDF stored for this paper")
    return FileResponse(path, media_type="application/pdf")


class ExplainIn(BaseModel):
    passage: str = ""
    question: str = ""
    mode: Literal["explain", "simplify", "translate"] = "explain"


def setting(key: str) -> str:
    with db.connect() as conn:
        row = conn.execute("select value from settings where key = ?", (key,)).fetchone()
    return row["value"] if row else ""


class AnswersIn(BaseModel):
    answers: list[str]


@app.post("/api/papers/{paper_id}/skim")
def skim_paper(paper_id: int):
    paper = get_paper(paper_id)
    result = llm.skim(paper, goal=goal_of(paper))
    status = "skimmed" if paper["status"] == "new" else paper["status"]
    update_paper(paper_id, skim=json.dumps(result), status=status)
    return result


def explain_request(paper_id: int, body: ExplainIn) -> tuple[dict, str, str, str]:
    paper = get_paper(paper_id)
    passage, question = body.passage.strip(), body.question.strip()
    if not passage and not question:
        raise HTTPException(400, "Select a passage or ask a question.")
    language = setting("language")
    if body.mode == "translate" and not language:
        raise HTTPException(400, "Set your language in Settings first, so Claude knows what to translate into.")
    return paper, passage, question, language


def save_explanation(paper_id: int, passage: str, question: str, answer: str, mode: str) -> None:
    with db.connect() as conn:
        conn.execute("insert into explanations (paper_id, passage, question, answer, mode) values (?, ?, ?, ?, ?)",
                     (paper_id, passage, question, answer, mode))
    index.index_paper(get_paper(paper_id))
    library.sync_paper(paper_id)


@app.post("/api/papers/{paper_id}/explain")
def explain_passage(paper_id: int, body: ExplainIn):
    paper, passage, question, language = explain_request(paper_id, body)
    answer = llm.explain(paper, passage, question, mode=body.mode, language=language)
    save_explanation(paper_id, passage, question, answer, body.mode)
    return {"explanation": answer}


@app.post("/api/papers/{paper_id}/explain/stream")
def explain_passage_stream(paper_id: int, body: ExplainIn):
    """The answer as Claude writes it: one JSON object per line, {"text"} pieces then {"done"} or {"error"}."""
    paper, passage, question, language = explain_request(paper_id, body)

    def lines():
        parts = []
        try:
            for piece in llm.explain_stream(paper, passage, question, mode=body.mode, language=language):
                parts.append(piece)
                yield json.dumps({"text": piece}) + "\n"
        except llm.AIError as e:
            yield json.dumps({"error": str(e)}) + "\n"
            return
        save_explanation(paper_id, passage, question, "".join(parts), body.mode)
        yield json.dumps({"done": True}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/papers/{paper_id}/explanations")
def list_explanations(paper_id: int):
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "select id, passage, question, answer, mode, created_at from explanations where paper_id = ? order by id desc",
            (paper_id,))]


class SettingsIn(BaseModel):
    library_dir: str | None = None
    ai_backend: Literal["api", "claude-code", "openai"] | None = None
    ai_provider: str | None = None  # one of llm.PROVIDERS
    ai_base_url: str | None = None  # empty: the provider's usual address
    ai_api_key: str | None = None  # kept on this computer, never sent back to the page
    ai_model: str | None = None
    ai_context: Literal["full", "32k", "8k"] | None = None
    language: str | None = None  # the reader's first language, for translations
    name: str | None = None  # what the Library greets you with; empty means just "Good morning"


def openai_settings() -> dict:
    """The OpenAI-compatible model choice, without the key itself (only whether one is set)."""
    cfg = llm.openai_config()
    return {"ai_provider": cfg["provider"], "ai_base_url": cfg["base_url"], "ai_model": cfg["model"],
            "ai_key_set": bool(cfg["api_key"]), "ai_context": setting("ai_context") or "full",
            "ai_name": llm.ai_name(), "providers": llm.PROVIDERS}


def settings() -> dict:
    folder = library.root()
    return {"library_dir": str(folder) if folder else "", "inbox": str(folder / library.INBOX) if folder else "",
            "suggested": str(Path.home() / "Documents" / "Papers"),
            "ai_backend": llm.backend(), "ai_ready": llm.configured(), "claude_binary": llm.claude_binary() or "",
            **openai_settings(),
            "language": setting("language"), "name": setting("name"),
            "api_key_set": bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))}


@app.get("/api/settings")
def read_settings():
    return settings()


@app.put("/api/settings")
def save_settings(body: SettingsIn):
    with db.connect() as conn:
        if body.ai_backend:
            conn.execute("insert or replace into settings (key, value) values ('ai_backend', ?)", (body.ai_backend,))
        for key in ("ai_provider", "ai_base_url", "ai_api_key", "ai_model", "ai_context"):
            value = getattr(body, key)
            if value is not None:
                conn.execute("insert or replace into settings (key, value) values (?, ?)", (key, value.strip()))
        if body.ai_provider is not None and body.ai_base_url is None:
            conn.execute("delete from settings where key = 'ai_base_url'")  # a new provider starts at its usual address
        if body.language is not None:
            conn.execute("insert or replace into settings (key, value) values ('language', ?)", (body.language.strip(),))
        if body.name is not None:
            conn.execute("insert or replace into settings (key, value) values ('name', ?)", (body.name.strip()[:60],))
    if body.library_dir is None:
        return settings()
    try:
        library.set_root(body.library_dir)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except OSError as e:
        raise HTTPException(400, f"Couldn't use that folder: {e}")
    return settings()


@app.post("/api/ai/test")
def test_ai():
    """A tiny real request, so the user knows their choice in Settings works."""
    try:
        llm.search_queries("checking the connection")
    except llm.AIError as e:
        return {"ok": False, "message": str(e)}
    if llm.backend() == "openai":
        cfg = llm.openai_config()
        return {"ok": True, "message": f"{cfg['model']} answered through {cfg['name']}."}
    via = "Claude Code" if llm.backend() == "claude-code" else "the API"
    return {"ok": True, "message": f"Claude answered through {via}."}


@app.get("/api/ai/models")
def ai_models():
    """The models the chosen OpenAI-compatible server offers, to pick from in Settings."""
    try:
        return {"models": llm.list_models()}
    except llm.AIError as e:
        raise HTTPException(400, str(e))


_inbox_skipped: set[tuple] = set()  # files that aren't importable; don't retry until they change


def import_inbox() -> int:
    """Import PDFs dropped into the library's Inbox folder; returns how many were added."""
    base = library.root()
    inbox = base / library.INBOX if base else None
    if not inbox or not inbox.is_dir():
        return 0
    added = 0
    for f in sorted(inbox.iterdir()):
        key = (f.name, f.stat().st_size, f.stat().st_mtime)
        if f.suffix.lower() != ".pdf" or key in _inbox_skipped:
            continue
        data = f.read_bytes()
        if not pdf.is_pdf(data):
            _inbox_skipped.add(key)
            continue
        text = read_pdf(data)
        prepare_paper(store_pdf_paper(data, text, describe_pdf(data, text, f.name), None))
        f.unlink()  # its content now lives in the library (and its folder)
        added += 1
    return added


@app.post("/api/papers/{paper_id}/quiz")
def make_quiz(paper_id: int):
    paper = get_paper(paper_id)
    questions = llm.quiz(paper)
    update_paper(paper_id, quiz=json.dumps(questions), review_due=paper["review_due"] or date.today().isoformat())
    return questions


REVIEW_DAYS = [1, 3, 7, 21, 60]  # wait before the next review, by how many reviews went well


def schedule_review(paper_id: int, score: float) -> dict:
    """Spaced review: good recall waits longer next time, poor recall starts over."""
    step = get_paper(paper_id)["review_step"] or 0
    if score >= 0.7:
        step = min(step + 1, len(REVIEW_DAYS) - 1)
    elif score < 0.4:
        step = 0
    due = date.today() + timedelta(days=REVIEW_DAYS[step])
    return update_paper(paper_id, understanding=score, review_step=step, review_due=due.isoformat())


class RatingsIn(BaseModel):
    ratings: list[Literal[0, 0.5, 1]]  # missed, partly, got it; one per question


@app.post("/api/papers/{paper_id}/review")
def review_paper(paper_id: int, body: RatingsIn):
    paper = get_paper(paper_id)
    if not paper["quiz"] or len(body.ratings) != len(paper["quiz"]):
        raise HTTPException(400, "Rate every question of this paper's quiz.")
    return schedule_review(paper_id, sum(body.ratings) / len(body.ratings))


@app.get("/api/reviews/due")
def reviews_due():
    with db.connect() as conn:
        rows = conn.execute(
            "select id, title, authors, year, review_due, quiz from papers"
            " where quiz is not null and review_due <= ? and coalesce(archived, 0) = 0 order by review_due",
            (date.today().isoformat(),)).fetchall()
    return [{**{k: r[k] for k in ("id", "title", "authors", "year", "review_due")}, "questions": len(json.loads(r["quiz"]))}
            for r in rows]


@app.post("/api/papers/{paper_id}/quiz/grade")
def grade_quiz(paper_id: int, body: AnswersIn):
    paper = get_paper(paper_id)
    if not paper["quiz"]:
        raise HTTPException(400, "Generate a quiz first")
    result = llm.grade(paper, paper["quiz"], body.answers)
    schedule_review(paper_id, result["score"])
    return result


SLICES = 100  # a paper is tracked as 100 equal slices, each read or not
MAX_GAP = 3  # unread runs this short between read parts were read too (they slipped past mid-screen)


def fill_gaps(bits: str) -> str:
    return re.sub(r"(?<=1)0{1,%d}(?=1)" % MAX_GAP, lambda m: "1" * len(m[0]), bits)


class ProgressIn(BaseModel):
    position: float
    slices: list[int] = []  # slices the reader actually spent time on
    mode: Literal["read", "skim"] = "read"


@app.put("/api/papers/{paper_id}/progress")
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


@app.post("/api/papers/{paper_id}/finish")
def finish_paper(paper_id: int):
    paper = get_paper(paper_id)
    questions = json.dumps(paper["quiz"]) if paper["quiz"] else None
    if not questions:
        try:
            questions = json.dumps(llm.quiz(paper))
        except llm.AIError:
            pass  # still mark it read; the quiz can be written later
    due = date.today().isoformat() if questions else None  # first review right away, while it's fresh
    return update_paper(paper_id, status="read", progress=1.0, read_slices="1" * SLICES, quiz=questions, review_due=due)


# ---------- Notes and highlights ----------
Color = Literal["yellow", "green", "blue", "pink"]


class NoteIn(BaseModel):
    kind: Literal["note", "highlight"] = "note"
    body: str = ""
    quote: str = ""
    color: Color = "yellow"
    page: int | None = None
    position: float = Field(0, ge=0, le=1)
    anchor: dict | None = None

    @field_validator("body", "quote", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def has_text(self):
        if self.kind == "note" and not self.body:
            raise ValueError("A note needs some text")
        if self.kind == "highlight" and not self.quote:
            raise ValueError("A highlight needs the highlighted text")
        return self


class NoteEdit(BaseModel):
    body: str | None = None
    color: Color | None = None

    @field_validator("body", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


def notes_changed(paper_id: int) -> None:
    library.refresh_notes_text(paper_id)
    library.sync_paper(paper_id, follow_parent=False)


@app.get("/api/papers/{paper_id}/notes")
def list_notes(paper_id: int):
    get_paper(paper_id)
    return notes.list_for(paper_id)


@app.post("/api/papers/{paper_id}/notes", status_code=201)
def add_note(paper_id: int, body: NoteIn):
    get_paper(paper_id)
    note = notes.add(paper_id, **body.model_dump())
    notes_changed(paper_id)
    return note


def existing_note(note_id: int) -> dict:
    note = notes.get(note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    return note


@app.patch("/api/notes/{note_id}")
def edit_note(note_id: int, body: NoteEdit):
    note = existing_note(note_id)
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    if note["kind"] == "note" and fields.get("body") == "":
        raise HTTPException(422, "A note needs some text (delete it instead)")
    if fields:
        note = notes.edit(note_id, **fields)
        notes_changed(note["paper_id"])
    return note


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    note = existing_note(note_id)
    notes.delete(note_id)
    notes_changed(note["paper_id"])
    return Response(status_code=204)


@app.get("/api/search")
def search_library(q: str = ""):
    return index.search(q)


class RecallIn(BaseModel):
    idea: str


@app.post("/api/recall")
def recall(body: RecallIn):
    cands = index.candidates(body.idea)
    if not cands:
        return []
    try:
        matches = llm.recall(body.idea, cands)
    except llm.AIError:  # no Claude: plain keyword matches, with the passage that matched
        matches = [{"paper_id": c["id"], "reason": f"Matched: “{c['snippet']}”"} for c in cands if c["snippet"]]
    out = []
    with db.connect() as conn:
        for m in matches:
            row = conn.execute(
                "select id, title, authors, year, status from papers where id = ?", (m["paper_id"],)
            ).fetchone()
            if row:
                out.append({"paper": dict(row), "reason": m["reason"]})
    return out


@app.get("/api/papers/{paper_id}/references")
def paper_references(paper_id: int):
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


def find_references(paper: dict) -> list[dict]:
    """The paper's reference list: from Semantic Scholar when it knows the paper, else read from its PDF."""
    if paper["external_id"]:
        try:
            return scholar.references(paper["external_id"])
        except httpx.HTTPError:
            if not paper["text"]:
                raise
    if not paper["text"]:
        raise HTTPException(400, "This paper has no text to read references from. Upload its PDF.")
    return [{**r, "external_id": ""} for r in llm.extract_references(references_section(paper["text"]))]


def main_text_end(text: str) -> float:
    """Where the main text ends (the references start), as a fraction of the paper."""
    heads = list(re.finditer(r"(?m)^(\d+\s+)?(references|bibliography)\s*$", text, re.IGNORECASE))
    return heads[-1].start() / len(text) if heads and text else 1


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
