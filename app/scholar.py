"""Semantic Scholar Graph API client."""
import os
import re
import time
import xml.etree.ElementTree as ET

import httpx

API = "https://api.semanticscholar.org/graph/v1"
FIELDS = "title,authors,year,abstract,url,openAccessPdf,externalIds"


def _get(path: str, **params) -> dict:
    headers = {"x-api-key": key} if (key := os.environ.get("S2_API_KEY")) else {}
    for attempt in range(4):
        r = httpx.get(f"{API}{path}", params=params, headers=headers, timeout=30)
        if r.status_code != 429:
            break
        time.sleep(2 ** attempt)  # the keyless API is rate limited; back off and retry
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


def search_arxiv(query: str, limit: int = 10) -> list[dict]:
    r = httpx.get(
        "https://export.arxiv.org/api/query",
        params={"search_query": f"all:{query}", "max_results": limit},
        timeout=30,
    )
    r.raise_for_status()
    return parse_arxiv(r.text)


def references(external_id: str) -> list[dict]:
    data = _get(f"/paper/{external_id}/references", fields=FIELDS, limit=100)
    return [normalize(r["citedPaper"]) for r in data.get("data", []) if r.get("citedPaper", {}).get("title")]


def fetch_pdf(url: str) -> bytes:
    r = httpx.get(url, follow_redirects=True, timeout=60)
    r.raise_for_status()
    return r.content
