"""Semantic Scholar Graph API client."""
import os

import httpx

from app import pdf

API = "https://api.semanticscholar.org/graph/v1"
FIELDS = "title,authors,year,abstract,url,openAccessPdf"


def _get(path: str, **params) -> dict:
    headers = {"x-api-key": key} if (key := os.environ.get("S2_API_KEY")) else {}
    r = httpx.get(f"{API}{path}", params=params, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def normalize(raw: dict) -> dict:
    return {
        "external_id": raw.get("paperId") or "",
        "title": raw.get("title") or "",
        "authors": ", ".join(a["name"] for a in raw.get("authors") or []),
        "year": raw.get("year"),
        "abstract": raw.get("abstract") or "",
        "url": raw.get("url") or "",
        "pdf_url": (raw.get("openAccessPdf") or {}).get("url") or "",
    }


def search(query: str, limit: int = 10) -> list[dict]:
    data = _get("/paper/search", query=query, limit=limit, fields=FIELDS)
    return [normalize(p) for p in data.get("data", [])]


def references(external_id: str) -> list[dict]:
    data = _get(f"/paper/{external_id}/references", fields=FIELDS, limit=100)
    return [normalize(r["citedPaper"]) for r in data.get("data", []) if r.get("citedPaper", {}).get("title")]


def fetch_pdf_text(url: str) -> str:
    r = httpx.get(url, follow_redirects=True, timeout=60)
    r.raise_for_status()
    return pdf.extract_text(r.content)
