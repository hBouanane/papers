"""Finding papers: Semantic Scholar first, OpenAlex when it's busy, arXiv for exact titles.

A keyword search finds papers *about* a topic, not the ones a topic is built on: "attention mechanism" doesn't
return "Attention Is All You Need". So a goal's candidates come from three places, in this order of trust:
the classics the AI names (each looked up by its exact title), the keyword searches, and the papers that the
search results themselves cite most (`foundations`): a paper that most of the field's papers reference is one a
newcomer should read, whatever words it uses.

Both services limit how often they may be asked. Without a key Semantic Scholar is often busy; with a free key
it allows about one request a second, so calls are spaced out. Results are kept for an hour, so "Try again"
doesn't ask for the same things twice. Keys (optional) are set in Settings and kept in the system keychain.
"""
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from collections import Counter

import httpx

API = "https://api.semanticscholar.org/graph/v1"
OPENALEX = "https://api.openalex.org"
FIELDS = "title,authors,year,abstract,url,openAccessPdf,externalIds,citationCount"
OPENALEX_FIELDS = ("id,doi,display_name,publication_year,authorships,cited_by_count,best_oa_location,"
                   "primary_location,abstract_inverted_index,referenced_works")
KEEP_FOR = 3600  # seconds a search's results are reused
GAP = 1.1  # seconds between Semantic Scholar calls: its free key allows one a second


class Busy(Exception):
    """Every paper database refused or failed: say so, instead of showing an empty list."""


def s2_key() -> str:
    from papers import keys
    return os.environ.get("S2_API_KEY", "") or keys.get("search_key:semanticscholar")


def openalex_key() -> str:
    from papers import keys
    return os.environ.get("OPENALEX_API_KEY", "") or keys.get("search_key:openalex")


_busy_until = {"s2": 0.0, "openalex": 0.0}  # a service said "too many requests": skip it until then
_last_call = 0.0
_pace = threading.Lock()
_cache: dict[tuple, tuple[float, list[dict]]] = {}


def forget() -> None:
    """Drop kept results and busy marks (tests, and after a key is added)."""
    _cache.clear()
    _busy_until.update(s2=0.0, openalex=0.0)


def _remember(key: tuple, fetch) -> list[dict]:
    if (hit := _cache.get(key)) and time.monotonic() - hit[0] < KEEP_FOR:
        return hit[1]
    found = fetch()
    _cache[key] = (time.monotonic(), found)
    return found


def _s2(method: str, path: str, params: dict, json: dict | None = None) -> dict | list:
    global _last_call
    if time.monotonic() < _busy_until["s2"]:
        raise httpx.HTTPError("Semantic Scholar is busy right now")
    headers = {"x-api-key": key} if (key := s2_key()) else {}
    with _pace:  # one call at a time, spaced out
        for attempt in range(3):
            wait = _last_call + GAP - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            _last_call = time.monotonic()
            send = httpx.get if method == "GET" else httpx.post
            r = send(f"{API}{path}", params=params, headers=headers, timeout=30, **({"json": json} if json else {}))
            if r.status_code != 429:
                break
            if attempt < 2:
                time.sleep(2 ** attempt)
    if r.status_code == 429:  # still: don't make every following search wait for the same answer
        _busy_until["s2"] = time.monotonic() + 60
    r.raise_for_status()
    return r.json()


def _get(path: str, **params) -> dict:
    return _s2("GET", path, params)


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


# ---------- OpenAlex ----------
def _openalex(params: dict) -> dict:
    if time.monotonic() < _busy_until["openalex"]:
        raise httpx.HTTPError("OpenAlex is busy right now")
    if key := openalex_key():
        params = {**params, "api_key": key}
    r = httpx.get(f"{OPENALEX}/works", params=params, timeout=30)
    if r.status_code == 429:  # the day's budget is spent (it resets at midnight UTC), or too fast
        _busy_until["openalex"] = time.monotonic() + (3600 if "daily" in r.text else 30)
    r.raise_for_status()
    return r.json()


def _abstract(index: dict | None) -> str:
    """OpenAlex gives abstracts as word -> positions; put the words back in order."""
    if not index:
        return ""
    words = sorted((at, word) for word, places in index.items() for at in places)
    return " ".join(word for _, word in words)


def normalize_openalex(w: dict) -> dict:
    doi = (w.get("doi") or "").replace("https://doi.org/", "")
    page = (w.get("primary_location") or {}).get("landing_page_url") or ""
    arxiv = re.search(r"arxiv\.org/abs/([^\s?#v]+)", page) or re.search(r"10\.48550/arxiv\.(.+)$", doi, re.I)
    pdf = (w.get("best_oa_location") or {}).get("pdf_url") or (f"https://arxiv.org/pdf/{arxiv[1]}" if arxiv else "")
    return {
        "external_id": f"arXiv:{arxiv[1]}" if arxiv else f"DOI:{doi}" if doi else "",
        "title": w.get("display_name") or "",
        "authors": ", ".join(a["author"]["display_name"] for a in w.get("authorships") or [] if a.get("author")),
        "year": w.get("publication_year"),
        "abstract": _abstract(w.get("abstract_inverted_index")),
        "url": w.get("doi") or w.get("id") or "",
        "pdf_url": pdf or "",
        "citations": w.get("cited_by_count"),
        "openalex": w.get("id", "").rsplit("/", 1)[-1],
        "openalex_refs": [r.rsplit("/", 1)[-1] for r in w.get("referenced_works") or []],
    }


def search_openalex(query: str, limit: int = 10) -> list[dict]:
    data = _openalex({"search": query, "per_page": limit, "select": OPENALEX_FIELDS})
    return [normalize_openalex(w) for w in data.get("results", []) if w.get("display_name")]


# ---------- arXiv: good for exact titles, poor for topics ----------
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


# ---------- Searching ----------
def search(query: str, limit: int = 10) -> list[dict]:
    """Papers about `query`: Semantic Scholar, or OpenAlex when it's busy, or arXiv as a last resort."""
    def fetch() -> list[dict]:
        try:
            data = _get("/paper/search", query=query, limit=limit, fields=FIELDS)
            if found := [normalize(p) for p in data.get("data", [])]:
                return found
        except httpx.HTTPError:
            pass
        try:  # busy, or nothing for these words (its search is strict; OpenAlex's is looser)
            return search_openalex(query, limit)
        except httpx.HTTPError:
            return search_arxiv(query, limit)  # raises when it fails too
    return _remember(("search", query, limit), fetch)


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


FILLER = set("""a an the i im i'm we my our me to of on in for and or with about how what why which that this these those
is are be been being do does need needs want wants would like trying try understand understanding learn learning know
catch up get read reading study papers paper work working building build make using use into from at by as it its
so some more most really just also new latest recent better""".split())


def keywords(goal: str) -> str:
    """A goal said as a sentence, as search words ("I need to catch up on causal inference" -> "causal inference"),
    for when there's no AI to write the queries."""
    words = [w for w in re.findall(r"[\w'-]+", goal) if w.lower() not in FILLER]
    return " ".join(words) or goal


def norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def resolve(title: str) -> dict | None:
    """Find the paper with exactly this title, if it exists: Semantic Scholar, then OpenAlex, then arXiv."""
    exact = lambda results: next((r for r in results if norm_title(r["title"]) == norm_title(title)), None)
    try:
        if match := exact(search(title, limit=5)):
            return match
    except (httpx.HTTPError, ET.ParseError):
        pass
    for finder in (lambda: search_openalex(title, 5), lambda: search_arxiv(title, 5, title=True)):
        try:
            if match := exact(finder()):
                return match
        except (httpx.HTTPError, ET.ParseError):
            continue
    return None


# ---------- The papers a topic is built on ----------
def _s2_id(p: dict) -> str:
    """The id Semantic Scholar's batch lookup takes for this paper, if any."""
    eid = p.get("external_id") or ""
    if re.fullmatch(r"[0-9a-f]{40}", eid):
        return eid
    if eid.startswith("arXiv:"):
        return "ARXIV:" + eid[6:]
    if eid.startswith("DOI:"):
        return eid
    return ""


def foundations(found: list[dict], most: int = 10) -> list[dict]:
    """Mark each paper with how many of the others cite it (`cited_here`), and bring in the papers they cite most
    that the searches missed (marked `foundation`). A paper most of the results build on is where to start.
    Uses Semantic Scholar's batch lookup (two calls in all); OpenAlex's reference lists when it's busy.
    Anything going wrong leaves the list as it was."""
    try:
        return _foundations_s2(found, most)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        pass
    try:
        return _foundations_openalex(found, most)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return found


def _foundations_s2(found: list[dict], most: int) -> list[dict]:
    ids = [i for p in found if (i := _s2_id(p))][:60]
    if len(ids) < 3:
        raise ValueError("too few papers to compare")
    rows = _s2("POST", "/paper/batch", {"fields": "paperId,references.paperId"}, json={"ids": ids})
    own = {}  # Semantic Scholar id -> the paper in `found`
    by_id = {_s2_id(p): p for p in found if _s2_id(p)}
    cited = Counter()
    for asked, row in zip(ids, rows):
        if not row:
            continue
        own[row["paperId"]] = by_id[asked]
        cited.update({r["paperId"] for r in row.get("references") or [] if r.get("paperId")})
    for pid, p in own.items():
        p["cited_here"] = cited.get(pid, 0)
    missing = [pid for pid, n in cited.most_common() if n >= 2 and pid not in own][:most]
    if missing:
        extra = _s2("POST", "/paper/batch", {"fields": FIELDS}, json={"ids": missing})
        for pid, row in zip(missing, extra):
            if row and row.get("title"):
                found.append({**normalize(row), "cited_here": cited[pid], "foundation": True})
    return found


def _foundations_openalex(found: list[dict], most: int) -> list[dict]:
    mine = [p for p in found if p.get("openalex")]
    if len(mine) < 3:
        raise ValueError("too few papers to compare")
    cited = Counter(w for p in mine for w in set(p.get("openalex_refs") or []))
    own = {p["openalex"]: p for p in mine}
    for wid, p in own.items():
        p["cited_here"] = cited.get(wid, 0)
    missing = [wid for wid, n in cited.most_common() if n >= 2 and wid not in own][:most]
    if missing:
        data = _openalex({"filter": "openalex:" + "|".join(missing), "per_page": len(missing), "select": OPENALEX_FIELDS})
        for w in data.get("results", []):
            p = normalize_openalex(w)
            found.append({**p, "cited_here": cited[p["openalex"]], "foundation": True})
    return found


def gather(queries: list[str], titles: list[str] = (), per_query: int = 10, most: int = 40) -> list[dict]:
    """Candidates for a goal, best first: the named classics (by exact title, marked `landmark`), then the papers
    the results cite most, then the rest of what the keyword searches returned. No repeats.
    Raises Busy when nothing came back because every service failed, rather than returning nothing."""
    seen, found, failed = set(), [], []

    def keep(p: dict) -> None:
        key = norm_title(p["title"])  # the same paper comes back under different ids from different sources
        if p["title"] and key not in seen:
            seen.add(key)
            found.append(p)
    for title in titles:
        if match := resolve(title):
            keep({**match, "landmark": True})
    for query in queries:
        try:
            results = search(query, limit=per_query)
        except (httpx.HTTPError, ET.ParseError) as e:  # one failed search shouldn't lose the others
            failed.append(e)
            continue
        for p in results:
            keep(p)
    if not found and failed:
        raise Busy("The paper databases are busy right now (they limit how often they can be asked). "
                   "Try again in a minute, or add a free search key in Settings.")
    before = len(found)
    for p in foundations(found)[before:]:  # the ones it brought in, if not already here under another id
        key = norm_title(p["title"])
        if key in seen:
            found.remove(p)
        else:
            seen.add(key)
    order = {id(p): i for i, p in enumerate(found)}
    built_on = lambda p: (p.get("cited_here") or 0) >= 2
    found.sort(key=lambda p: (not p.get("landmark"), not built_on(p), -(p.get("cited_here") or 0) if built_on(p) else 0,
                              order[id(p)]))
    for p in found:
        p.pop("openalex_refs", None)
    return found[:most]


def references(external_id: str) -> list[dict]:
    data = _get(f"/paper/{external_id}/references", fields=FIELDS, limit=100)
    return [normalize(r["citedPaper"]) for r in data.get("data", []) if r.get("citedPaper", {}).get("title")]


def fetch_pdf(url: str) -> bytes:
    r = httpx.get(url, follow_redirects=True, timeout=60)
    r.raise_for_status()
    return r.content
