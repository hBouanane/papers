import io

from pypdf import PdfReader


def extract_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join(t for page in reader.pages if (t := page.extract_text() or "").strip())
