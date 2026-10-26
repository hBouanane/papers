import io

from pypdf import PdfWriter

from app import llm, pdf, scholar


def s2(pid, title):
    return {"external_id": pid, "title": title, "authors": "A", "year": 2020,
            "abstract": "abs", "url": "u", "pdf_url": ""}


def test_normalize_s2_paper():
    raw = {"paperId": "p1", "title": "T", "authors": [{"name": "Ann"}, {"name": "Bob"}],
           "year": 2021, "abstract": None, "url": "http://s2/p1",
           "openAccessPdf": {"url": "http://x.pdf"}}
    assert scholar.normalize(raw) == {
        "external_id": "p1", "title": "T", "authors": "Ann, Bob", "year": 2021,
        "abstract": "", "url": "http://s2/p1", "pdf_url": "http://x.pdf"}


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
    monkeypatch.setattr(scholar, "fetch_pdf_text", lambda url: "full text")
    t = client.post("/api/topics", json={"goal": "g"}).json()
    p = client.post("/api/papers", json={"topic_id": t["id"], "title": "P", "pdf_url": "http://x.pdf"}).json()
    assert p["text"] == "full text" and p["status"] == "new" and p["progress"] == 0
    assert client.get(f"/api/papers/{p['id']}").json()["text"] == "full text"
    assert [x["id"] for x in client.get(f"/api/papers?topic_id={t['id']}").json()] == [p["id"]]


def test_add_paper_without_pdf_and_missing_paper(client):
    p = client.post("/api/papers", json={"title": "P", "abstract": "only abstract"}).json()
    assert p["text"] == ""
    assert client.get("/api/papers/999").status_code == 404


def test_upload_pdf(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "uploaded text")
    p = client.post("/api/papers", json={"title": "P"}).json()
    r = client.post(f"/api/papers/{p['id']}/pdf", files={"file": ("p.pdf", b"%PDF", "application/pdf")})
    assert r.json()["text"] == "uploaded text"


def test_extract_text_blank_pdf():
    w = PdfWriter()
    w.add_blank_page(100, 100)
    buf = io.BytesIO()
    w.write(buf)
    assert pdf.extract_text(buf.getvalue()) == ""
