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
