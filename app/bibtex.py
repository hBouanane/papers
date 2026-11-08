"""BibTeX entries built from what we know about a paper."""
import re

SKIP = {"a", "an", "the", "on", "of"}


def key(p: dict) -> str:
    first_author = (p.get("authors") or "").split(",")[0].replace("et al.", "").split()
    surname = re.sub(r"[^a-z]", "", first_author[-1].lower()) if first_author else ""
    words = [re.sub(r"[^a-z0-9]", "", w.lower()) for w in p["title"].split()]
    word = next((w for w in words if w and w not in SKIP), "")
    return f"{surname or 'paper'}{p.get('year') or ''}{word}"


def entry(p: dict) -> str:
    ext = p.get("external_id") or ""
    arxiv = ext.removeprefix("arXiv:") if ext.startswith("arXiv:") else ""
    fields = [
        ("title", "{" + p["title"].replace("{", "").replace("}", "") + "}"),
        ("author", " and ".join(a.strip() for a in (p.get("authors") or "").split(",") if a.strip())),
        ("year", str(p["year"]) if p.get("year") else ""),
        ("eprint", arxiv),
        ("archivePrefix", "arXiv" if arxiv else ""),
        ("doi", ext.removeprefix("DOI:") if ext.startswith("DOI:") else ""),
        ("url", p.get("url") or ""),
    ]
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields if value)
    return f"@{'misc' if arxiv else 'article'}{{{key(p)},\n{body}\n}}\n"
