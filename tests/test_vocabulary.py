from app import llm, pdf, scholar
from tests.test_papers import blank_pdf

WORDS = [
    {"term": "attention", "kind": "technical", "meaning": "A way for the model to focus on the most useful words.",
     "example": "An attention function can be described as mapping a query..."},
    {"term": "albeit", "kind": "english", "meaning": "Although; even though.", "example": "albeit at the cost of reduced resolution"},
]


def make(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


def test_vocabulary_is_generated_once_and_kept(client, monkeypatch):
    calls = []
    monkeypatch.setattr(llm, "glossary", lambda paper, **kw: calls.append(1) or WORDS)
    p = make(client)
    from app.main import update_paper
    update_paper(p["id"], text="An attention function ... albeit at the cost of reduced resolution")
    assert client.post(f"/api/papers/{p['id']}/glossary").json() == WORDS
    assert client.get(f"/api/papers/{p['id']}").json()["glossary"] == WORDS
    assert len(calls) == 1


def test_vocabulary_needs_text(client):
    p = make(client)
    r = client.post(f"/api/papers/{p['id']}/glossary")
    assert r.status_code == 400 and "text" in r.json()["detail"]


def test_vocabulary_goes_into_the_notes_file(client, tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "glossary", lambda paper, **kw: WORDS)
    root = tmp_path / "Papers"
    client.put("/api/settings", json={"library_dir": str(root)})
    p = make(client, title="Words")
    from app.main import update_paper
    update_paper(p["id"], text="body")
    client.post(f"/api/papers/{p['id']}/glossary")
    md = (root / "Unsorted" / "Words.md").read_text(encoding="utf-8")
    assert "## Vocabulary" in md and "**albeit** (English): Although; even though." in md


def test_fetch_original_pdf_for_older_papers(client, monkeypatch):
    urls = []
    monkeypatch.setattr(scholar, "fetch_pdf", lambda url: urls.append(url) or blank_pdf())
    monkeypatch.setattr(pdf, "extract_text", lambda data: "text from pdf")
    # created without any PDF source, then given an arXiv id (as older papers were)
    p = make(client, title="Old")
    from app.main import update_paper
    update_paper(p["id"], external_id="arXiv:1706.03762", text="old text")
    assert client.get(f"/api/papers/{p['id']}").json()["can_fetch_pdf"] is True
    r = client.post(f"/api/papers/{p['id']}/fetch-pdf").json()
    assert urls == ["https://arxiv.org/pdf/1706.03762"]
    assert r["has_pdf"] is True and r["text"] == "old text"  # existing text is kept
    assert r["can_fetch_pdf"] is False


def test_pdf_source_order():
    from app.main import pdf_source
    assert pdf_source({"pdf_url": "https://x/a.pdf", "external_id": "arXiv:1", "url": ""}) == "https://x/a.pdf"
    assert pdf_source({"pdf_url": "", "external_id": "", "url": "http://arxiv.org/abs/2006.11239v2"}) == "https://arxiv.org/pdf/2006.11239v2"
    assert pdf_source({"pdf_url": "", "external_id": "abc", "url": "https://semanticscholar.org/p"}) is None


def test_fetch_pdf_without_source_is_400(client):
    p = make(client)
    assert client.post(f"/api/papers/{p['id']}/fetch-pdf").status_code == 400


def test_extracted_text_has_no_nul_characters(monkeypatch):
    class Page:
        def extract_text(self):
            return "a\x00b"

    class Reader:
        pages = [Page()]

    monkeypatch.setattr(pdf, "PdfReader", lambda f: Reader())
    assert pdf.extract_text(b"%PDF-") == "ab"
