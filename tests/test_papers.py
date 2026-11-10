import io

from pypdf import PdfWriter

from papers import llm, pdf, scholar


def s2(pid, title):
    return {"external_id": pid, "title": title, "authors": "A", "year": 2020,
            "abstract": "abs", "url": "u", "pdf_url": ""}


def test_normalize_s2_paper():
    raw = {"paperId": "p1", "title": "T", "authors": [{"name": "Ann"}, {"name": "Bob"}],
           "year": 2021, "abstract": None, "url": "http://s2/p1",
           "openAccessPdf": {"url": "http://x.pdf"}}
    assert scholar.normalize(raw) == {
        "external_id": "p1", "title": "T", "authors": "Ann, Bob", "year": 2021,
        "abstract": "", "url": "http://s2/p1", "pdf_url": "http://x.pdf", "citations": None}


def test_normalize_uses_arxiv_pdf_when_no_open_access():
    raw = {"paperId": "p1", "title": "T", "openAccessPdf": {"url": ""}, "externalIds": {"ArXiv": "2101.1"}}
    assert scholar.normalize(raw)["pdf_url"] == "https://arxiv.org/pdf/2101.1"


def test_topics_crud(client):
    t = client.post("/api/topics", json={"goal": "diffusion models"}).json()
    assert t["goal"] == "diffusion models"
    assert client.get("/api/topics").json() == [t]


def test_search_uses_ai_queries_and_dedupes(client, monkeypatch):
    monkeypatch.setattr(llm, "search_queries", lambda goal: ["q1", "q2"])
    results = {"q1": [s2("a", "A"), s2("b", "B")], "q2": [s2("b", "B"), s2("c", "C")]}
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: results[q])
    t = client.post("/api/topics", json={"goal": "g"}).json()
    found = client.get(f"/api/topics/{t['id']}/search").json()
    assert [p["external_id"] for p in found] == ["a", "b", "c"]


def test_add_paper_fetches_pdf_text(client, monkeypatch):
    monkeypatch.setattr(scholar, "fetch_pdf", lambda url: blank_pdf())
    monkeypatch.setattr(pdf, "extract_text", lambda data: "full text")
    t = client.post("/api/topics", json={"goal": "g"}).json()
    p = client.post("/api/papers", json={"topic_id": t["id"], "title": "P", "pdf_url": "http://x.pdf"}).json()
    assert p["text"] == "full text" and p["status"] == "new" and p["progress"] == 0
    assert client.get(f"/api/papers/{p['id']}").json()["text"] == "full text"
    assert [x["id"] for x in client.get(f"/api/papers?topic_id={t['id']}").json()] == [p["id"]]


def test_add_paper_without_pdf_and_missing_paper(client):
    p = client.post("/api/papers", json={"title": "P", "abstract": "only abstract"}).json()
    assert p["text"] == ""
    assert client.get("/api/papers/999").status_code == 404


def blank_pdf(title=None):
    w = PdfWriter()
    w.add_blank_page(100, 100)
    if title:
        w.add_metadata({"/Title": title})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_upload_pdf(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "uploaded text")
    p = client.post("/api/papers", json={"title": "P"}).json()
    r = client.post(f"/api/papers/{p['id']}/pdf", files={"file": ("p.pdf", blank_pdf(), "application/pdf")})
    assert r.json()["text"] == "uploaded text"


def test_extract_text_blank_pdf():
    w = PdfWriter()
    w.add_blank_page(100, 100)
    buf = io.BytesIO()
    w.write(buf)
    assert pdf.extract_text(buf.getvalue()) == ""


def test_search_falls_back_to_goal_when_ai_fails(client, monkeypatch):
    def boom(goal):
        raise RuntimeError("no key")

    monkeypatch.setattr(llm, "search_queries", boom)
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: [s2(q, q)])
    t = client.post("/api/topics", json={"goal": "graph nets"}).json()
    assert [p["external_id"] for p in client.get(f"/api/topics/{t['id']}/search").json()] == ["graph nets"]


def test_scholar_retries_on_rate_limit(monkeypatch):
    import httpx
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        code = 429 if len(calls) < 3 else 200
        return httpx.Response(code, json={"data": []}, request=httpx.Request("GET", url))

    monkeypatch.setattr(scholar.httpx, "get", fake_get)
    monkeypatch.setattr(scholar.time, "sleep", lambda s: None)
    assert scholar.search("q") == [] and len(calls) == 3


def test_upstream_errors_become_502(client, monkeypatch):
    import httpx

    def fail(q, limit=10):
        raise httpx.HTTPError("down")

    monkeypatch.setattr(llm, "search_queries", lambda goal: ["q"])
    monkeypatch.setattr(scholar, "search", fail)
    t = client.post("/api/topics", json={"goal": "g"}).json()
    r = client.get(f"/api/topics/{t['id']}/search")
    assert r.status_code == 502 and "Semantic Scholar" in r.json()["detail"]


ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
      You Need</title>
    <summary> The dominant models... </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
</feed>"""


def test_parse_arxiv():
    assert scholar.parse_arxiv(ATOM) == [{
        "external_id": "arXiv:1706.03762", "title": "Attention Is All You Need",
        "authors": "Ashish Vaswani, Noam Shazeer", "year": 2017, "abstract": "The dominant models...",
        "url": "http://arxiv.org/abs/1706.03762v7", "pdf_url": "http://arxiv.org/pdf/1706.03762v7"}]


def test_search_falls_back_to_arxiv(monkeypatch):
    import httpx

    def fail(path, **params):
        raise httpx.HTTPError("429")

    monkeypatch.setattr(scholar, "_get", fail)
    monkeypatch.setattr(scholar, "search_arxiv", lambda q, limit=10: [{"external_id": "arXiv:1"}])
    assert scholar.search("q") == [{"external_id": "arXiv:1"}]


def test_reflow_joins_wrapped_lines_keeps_paragraphs():
    raw = "1 Introduction\nThe model uses atten-\ntion layers and many\nother things.\nNext paragraph here"
    assert pdf.reflow(raw) == "1 Introduction\nThe model uses attention layers and many other things.\nNext paragraph here"


def test_list_carries_each_papers_summary_line(client):
    from papers.store import update_paper
    p = client.post("/api/papers", json={"title": "P"}).json()
    update_paper(p["id"], skim='{"tldr": "It adds noise, then learns to undo it.", "key_idea": "Denoising as generation.", "verdict": "v"}')
    listed = next(x for x in client.get("/api/papers").json() if x["id"] == p["id"])
    assert (listed["tldr"], listed["key_idea"]) == ("It adds noise, then learns to undo it.", "Denoising as generation.")
    q = client.post("/api/papers", json={"title": "Q"}).json()
    assert next(x for x in client.get("/api/papers").json() if x["id"] == q["id"])["tldr"] is None
