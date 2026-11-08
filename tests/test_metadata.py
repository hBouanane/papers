from app import llm, pdf, scholar
from tests.test_papers import blank_pdf


def upload(client, data=None):
    return client.post("/api/papers/upload", files={"file": ("f.pdf", data or blank_pdf(), "application/pdf")}).json()


def test_title_from_largest_font_joins_wrapped_lines():
    spans = [(9.0, "arXiv notice"), (17.2, "Attention Is All"), (17.0, "You Need"), (12.0, "Abstract"), (17.2, "2 METHOD")]
    assert pdf.title_from_spans(spans) == "Attention Is All You Need"


def test_title_from_spans_ignores_tiny_or_numbered():
    assert pdf.title_from_spans([(20.0, "3"), (14.0, "A Real Title Here")]) == "A Real Title Here"
    assert pdf.title_from_spans([]) == ""


def test_guess_title_rejects_section_headings():
    assert pdf.guess_title({}, "2 M ETHOD\nDeep Nets for Things\nbody", "f") == "Deep Nets for Things"


def test_find_ids():
    text = "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023\nhttps://doi.org/10.1145/3292500.3330701."
    assert pdf.find_ids(text) == ["arXiv:1706.03762", "DOI:10.1145/3292500.3330701"]


def test_upload_uses_identifier_lookup(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "arXiv:1706.03762v7\nbody")
    monkeypatch.setattr(scholar, "lookup", lambda ident: {
        "external_id": ident, "title": "Attention Is All You Need", "authors": "Ashish Vaswani, Noam Shazeer",
        "year": 2017, "abstract": "a", "url": "u", "pdf_url": "p"})
    p = upload(client)
    assert (p["title"], p["year"], p["external_id"]) == ("Attention Is All You Need", 2017, "arXiv:1706.03762")


def test_edit_paper_details(client):
    t = client.post("/api/topics", json={"goal": "g"}).json()
    p = client.post("/api/papers", json={"title": "2 M ETHOD"}).json()
    r = client.patch(f"/api/papers/{p['id']}", json={"title": "Fixed", "authors": "A B", "year": 2021, "topic_id": t["id"]})
    assert (r.json()["title"], r.json()["year"], r.json()["topic_id"]) == ("Fixed", 2021, t["id"])
    assert client.patch(f"/api/papers/{p['id']}", json={"title": " "}).status_code == 422


def test_references_fall_back_to_pdf_bibliography_and_are_cached(client, monkeypatch):
    calls = []

    def fake(text):
        calls.append(text)
        return [{"title": "Neural Machine Translation", "authors": "Bahdanau, Cho", "year": 2014}]

    monkeypatch.setattr(llm, "extract_references", fake)
    p = client.post("/api/papers", json={"title": "P"}).json()
    from app.main import update_paper
    update_paper(p["id"], text="Intro text.\nReferences\n[1] Bahdanau, Cho. Neural Machine Translation. 2014.")
    for _ in range(2):
        refs = client.get(f"/api/papers/{p['id']}/references").json()
    assert refs == [{"title": "Neural Machine Translation", "authors": "Bahdanau, Cho", "year": 2014,
                     "external_id": "", "library_id": None}]
    assert len(calls) == 1 and calls[0].startswith("References")


def test_references_without_any_source_is_400(client):
    p = client.post("/api/papers", json={"title": "P"}).json()
    assert client.get(f"/api/papers/{p['id']}/references").status_code == 400


def test_adding_title_only_reference_resolves_it_by_search(client, monkeypatch):
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: [
        {"external_id": "x", "title": "Something Else", "authors": "", "year": 2001, "abstract": "", "url": "", "pdf_url": ""},
        {"external_id": "s2", "title": "Neural machine translation.", "authors": "Bahdanau", "year": 2014,
         "abstract": "abs", "url": "u", "pdf_url": ""}])
    p = client.post("/api/papers", json={"title": "Neural Machine Translation", "year": 2014}).json()
    assert (p["external_id"], p["abstract"]) == ("s2", "abs")
