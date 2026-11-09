"""/api/papers: adding papers (search result, link, PDF upload), listing, editing, deleting, and their PDFs."""
import re
from typing import Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator

from papers import db, figures, index, library, pdf, scholar
from papers.ai import providers
from papers.chat import store as chat
from papers.ingest import describe_pdf, prepare_paper, read_pdf, store_pdf_paper
from papers.store import find_existing, get_paper, insert_paper, pdf_source, save_pdf, update_paper

router = APIRouter(prefix="/api/papers", tags=["papers"])


class PaperIn(BaseModel):
    title: str
    topic_id: int | None = None
    authors: str = ""
    year: int | None = None
    abstract: str = ""
    url: str = ""
    pdf_url: str = ""
    external_id: str = ""
    source_paper_id: int | None = None  # the paper whose references led to this one (the Map's chains)


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


class LinkIn(BaseModel):
    link: str
    topic_id: int | None = None


class PrepareIn(BaseModel):
    # Parts to write again with the model chosen now (a better model can do better).
    redo: list[Literal["skim", "glossary", "quiz"]] = []


@router.post("")
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
            pass  # the user can upload the PDF instead
    text = pdf.extract_text(data) if pdf.is_pdf(data) else ""
    paper_id = insert_paper({**body.model_dump(), "text": text})
    if pdf.is_pdf(data):
        save_pdf(paper_id, data)
    background.add_task(prepare_paper, paper_id)
    return get_paper(paper_id)


@router.post("/from-link")
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


@router.post("/upload")
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


@router.get("")
def list_papers(topic_id: int | None = None, archived: bool = False):
    """Papers in the library (archived ones only when asked for)."""
    cols = ("id, topic_id, title, authors, year, external_id, status, progress, position, understanding,"
            " source_paper_id, read_slices, archived, updated_at, text,"
            # one line from the key points, for overviews (goal pages, Recall)
            " json_extract(skim, '$.tldr') as tldr, json_extract(skim, '$.key_idea') as key_idea")
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


@router.get("/{paper_id}")
def read_paper(paper_id: int):
    return get_paper(paper_id)


@router.patch("/{paper_id}")
def edit_paper(paper_id: int, body: PaperEdit):
    get_paper(paper_id)
    fields = body.model_dump(exclude_unset=True)
    return update_paper(paper_id, **fields) if fields else get_paper(paper_id)


@router.delete("/{paper_id}", status_code=204)
def delete_paper(paper_id: int):
    paper = get_paper(paper_id)
    library.remove(paper)
    index.remove(paper_id)
    db.pdf_path(paper_id).unlink(missing_ok=True)
    figures.forget(paper_id)
    with db.connect() as conn:
        conn.execute("delete from explanations where paper_id = ?", (paper_id,))
    chat.delete_for_paper(paper_id)
    with db.connect() as conn:
        conn.execute("delete from notes where paper_id = ?", (paper_id,))
        conn.execute("update papers set source_paper_id = null where source_paper_id = ?", (paper_id,))
        conn.execute("delete from papers where id = ?", (paper_id,))
    if paper["source_paper_id"]:
        library.sync_paper(paper["source_paper_id"], follow_parent=False)  # drop it from "Led to"
    return Response(status_code=204)


@router.get("/{paper_id}/file")
def paper_file(paper_id: int):
    path = db.pdf_path(paper_id)
    if not path.exists():
        raise HTTPException(404, "No PDF stored for this paper")
    return FileResponse(path, media_type="application/pdf")


@router.post("/{paper_id}/pdf")
async def upload_pdf(paper_id: int, file: UploadFile):
    get_paper(paper_id)
    data = await file.read()
    text = read_pdf(data)
    save_pdf(paper_id, data)
    return update_paper(paper_id, text=text)


@router.post("/{paper_id}/fetch-pdf")
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


@router.post("/{paper_id}/prepare")
def prepare(paper_id: int, background: BackgroundTasks, body: PrepareIn | None = None):
    """Fill in whatever the AI hasn't prepared yet for this paper (runs in the background)."""
    get_paper(paper_id)
    if body and body.redo:
        if not providers.configured():
            raise HTTPException(400, "Choose an AI model in Settings first.")
        with db.connect() as conn:  # cleared here, written again by prepare_paper below
            conn.execute(f"update papers set {', '.join(f'{f} = null' for f in body.redo)} where id = ?", (paper_id,))
    background.add_task(prepare_paper, paper_id)
    return get_paper(paper_id)
