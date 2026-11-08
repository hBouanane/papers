"""Adding papers (from a PDF, a link or the library folder's Inbox) and having the AI prepare them ahead of
time, so nothing makes the reader wait later."""
import json

import httpx
from fastapi import HTTPException

from papers import db, library, llm, pdf, scholar
from papers.ai import providers
from papers.store import (
    PREPARING,
    find_existing,
    get_paper,
    goal_of,
    insert_paper,
    references_section,
    save_pdf,
    update_paper,
)


def read_pdf(data: bytes) -> str:
    """The PDF's text; "" when it has no readable text layer (scanned), since it can still be viewed."""
    if not pdf.is_pdf(data):
        raise HTTPException(400, "That file isn't a PDF. Choose a .pdf file.")
    try:
        return pdf.extract_text(data)
    except Exception:
        return ""


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


def prepare_paper(paper_id: int) -> None:
    """Have the AI read a paper ahead of time: key points, vocabulary, review questions and references,
    each saved once. Steps that fail are left for later."""
    if not providers.configured() or paper_id in PREPARING:
        return
    PREPARING.add(paper_id)
    try:
        steps = [
            ("skim", lambda p: p["text"] and json.dumps(llm.skim(p, goal=goal_of(p)))),
            ("glossary", lambda p: p["text"] and json.dumps(llm.glossary(p, language=db.setting("language")))),
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


_inbox_skipped: set[tuple] = set()  # files that aren't importable; don't retry until they change


def import_inbox() -> int:
    """Import PDFs dropped into the library folder's Inbox; returns how many were added."""
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
