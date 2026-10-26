import io
import re

from pypdf import PdfReader


def reflow(text: str) -> str:
    """Join lines wrapped by the PDF layout; keep breaks after sentences and short lines (headings)."""
    out = ""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if not out:
            out = line
        elif out.endswith("-") and line[:1].islower():
            out = out[:-1] + line
        elif re.search(r"[.:?!]$", out) or len(out.rsplit("\n", 1)[-1]) < 40:
            out += "\n" + line
        else:
            out += " " + line
    return out


def extract_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return reflow("\n".join(page.extract_text() or "" for page in reader.pages))


def is_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def metadata(data: bytes) -> dict:
    try:
        return dict(PdfReader(io.BytesIO(data)).metadata or {})
    except Exception:
        return {}


def guess_title(meta: dict, text: str, fallback: str) -> str:
    """Title from PDF metadata when it looks real, else the first line of text, else the file name."""
    title = str(meta.get("/Title") or "").strip()
    junk = len(title) < 4 or "microsoft word" in title.lower() or "untitled" in title.lower() \
        or re.search(r"\.(pdf|docx?|tex|dvi)$", title.lower())
    if not junk:
        return title
    return next((line for line in map(str.strip, text.splitlines()[:20]) if _looks_like_title(line)), fallback)


def _looks_like_title(line: str) -> bool:
    words = line.split()
    noise = ("@", "http", "arxiv:", "©", "copyright")
    return 2 <= len(words) <= 20 and not line.endswith(".") and not any(n in line.lower() for n in noise)
