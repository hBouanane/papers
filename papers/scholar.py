"""Semantic Scholar Graph API client."""
import re
import time
import xml.etree.ElementTree as ET

import httpx

from papers import config

API = "https://api.semanticscholar.org/graph/v1"
FIELDS = "title,authors,year,abstract,url,openAccessPdf,externalIds,citationCount"


_busy_until = 0.0  # Semantic Scholar said "too many requests" until then: go straight to arXiv meanwhile


def _get(path: str, **params) -> dict:
    global _busy_until
    headers = {"x-api-key": key} if (key := config.semantic_scholar_key()) else {}
    if time.monotonic() < _busy_until:
        raise httpx.HTTPError("Semantic Scholar is rate limited right now")
    for attempt in range(3):
        r = httpx.get(f"{API}{path}", params=params, headers=headers, timeout=30)
        if r.status_code != 429:
            break
        if attempt < 2:
            time.sleep(2 ** attempt)  # the keyless API is rate limited; back off and retry
    if r.status_code == 429:  # still: don't make every following search wait for the same answer
        _busy_until = time.monotonic() + 60
    r.raise_for_status()
    return r.json()


def normalize(raw: dict) -> dict:
    pdf_url = (raw.get("openAccessPdf") or {}).get("url") or ""
    if not pdf_url and (arxiv := (raw.get("externalIds") or {}).get("ArXiv")):
        pdf_url = f"https://arxiv.org/pdf/{arxiv}"
    return {
        "external_id": raw.get("paperId") or "",
        "title": raw.get("title") or "",
        "authors": ", ".join(a["name"] for a in raw.get("authors") or []),
        "year": raw.get("year"),
        "abstract": raw.get("abstract") or "",
        "url": raw.get("url") or "",
        "pdf_url": pdf_url,
        "citations": raw.get("citationCount"),  # for ranking suggestions; not stored
    }


def search(query: str, limit: int = 10) -> list[dict]:
    try:
        data = _get("/paper/search", query=query, limit=limit, fields=FIELDS)
    except httpx.HTTPError:
        return search_arxiv(query, limit)  # Semantic Scholar is often rate limited without a key
    return [normalize(p) for p in data.get("data", [])]


def parse_arxiv(xml: str) -> list[dict]:
    ns = {"a": "http://www.w3.org/2005/Atom"}
    clean = lambda s: " ".join((s or "").split())
    papers = []
    for e in ET.fromstring(xml).findall("a:entry", ns):
        abs_url = e.findtext("a:id", "", ns)
        pdf = next((l.get("href") for l in e.findall("a:link", ns) if l.get("title") == "pdf"), "")
        papers.append({
            "external_id": "arXiv:" + re.sub(r"v\d+$", "", abs_url.rsplit("/abs/", 1)[-1]),
            "title": clean(e.findtext("a:title", "", ns)),
            "authors": ", ".join(clean(a.findtext("a:name", "", ns)) for a in e.findall("a:author", ns)),
            "year": int(e.findtext("a:published", "0", ns)[:4]) or None,
            "abstract": clean(e.findtext("a:summary", "", ns)),
            "url": abs_url,
            "pdf_url": pdf,
        })
    return papers


def search_arxiv(query: str, limit: int = 10, title: bool = False) -> list[dict]:
    """arXiv's own search. Every word must match (its default is any word, which returns papers about anything);
    with `title`, the words are looked for as a phrase in the title."""
    words = re.findall(r"[\w-]+", query)
    if title:
        terms = 'ti:"' + " ".join(words) + '"'
    else:
        terms = " AND ".join(f"all:{w}" for w in words[:8]) or f"all:{query}"
    r = httpx.get(
        "https://export.arxiv.org/api/query",
        params={"search_query": terms, "max_results": limit, "sortBy": "relevance"},
        timeout=30,
    )
    r.raise_for_status()
    return parse_arxiv(r.text)


def lookup(identifier: str) -> dict | None:
    """Official metadata for "arXiv:<id>", "DOI:<doi>" or a Semantic Scholar paper id."""
    try:
        if identifier.startswith("arXiv:"):
            r = httpx.get("https://export.arxiv.org/api/query", params={"id_list": identifier[6:]}, timeout=30)
            r.raise_for_status()
            found = parse_arxiv(r.text)
            return found[0] if found and found[0]["title"] else None
        return normalize(_get(f"/paper/{identifier}", fields=FIELDS))
    except (httpx.HTTPError, ET.ParseError):
        return None


ARXIV_ID = r"(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})"


def parse_link(link: str) -> str | None:
    """Turn an arXiv/DOI/Semantic Scholar link or bare ID into a lookup key, or None."""
    s = link.strip()
    if m := re.search(rf"arxiv\.org/(?:abs|pdf)/{ARXIV_ID}", s, re.IGNORECASE):
        return f"arXiv:{m[1]}"
    if m := re.fullmatch(rf"(?:arxiv:)?{ARXIV_ID}(?:v\d+)?", s, re.IGNORECASE):
        return f"arXiv:{m[1]}"
    if m := re.search(r"(10\.\d{4,9}/[^\s?#]+)", s):
        return f"DOI:{m[1]}"
    if m := re.search(r"semanticscholar\.org/paper/(?:[^/]+/)?([0-9a-f]{40})", s):
        return m[1]
    return None


def norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def resolve(title: str) -> dict | None:
    """Find the search result that is this exact paper (by title), if any."""
    exact = lambda results: next((r for r in results if norm_title(r["title"]) == norm_title(title)), None)
    try:
        if match := exact(search(title, limit=5)):
            return match
        return exact(search_arxiv(title, 5, title=True))  # the keyword search missed it: ask arXiv for the title
    except (httpx.HTTPError, ET.ParseError):
        return None


def gather(queries: list[str], titles: list[str] = (), per_query: int = 10, most: int = 40,
           quiet: bool = False) -> list[dict]:
    """Candidates for a goal: the named papers first (each found by its exact title, marked `landmark`), then
    what the keyword searches return, without repeats."""
    seen, found = set(), []

    def keep(p: dict) -> None:
        key = norm_title(p["title"])  # the same paper comes back under different ids from the two sources
        if p["title"] and key not in seen:
            seen.add(key)
            found.append(p)
    for title in titles:
        if match := resolve(title):
            keep({**match, "landmark": True})
    for query in queries:
        try:
            results = search(query, limit=per_query)
        except (httpx.HTTPError, ET.ParseError):
            if quiet:  # one failed search shouldn't lose the others
                continue
            raise
        for p in results:
            keep(p)
    return found[:most]


def references(external_id: str) -> list[dict]:
    data = _get(f"/paper/{external_id}/references", fields=FIELDS, limit=100)
    return [normalize(r["citedPaper"]) for r in data.get("data", []) if r.get("citedPaper", {}).get("title")]


def fetch_pdf(url: str) -> bytes:
    r = httpx.get(url, follow_redirects=True, timeout=60)
    r.raise_for_status()
    return r.content
