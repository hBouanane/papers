from papers import pdf
from tests.test_papers import blank_pdf


def upload(client, data, **form):
    return client.post("/api/papers/upload", files={"file": ("my paper.pdf", data, "application/pdf")}, data=form)


def test_upload_creates_paper_and_stores_pdf(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Deep Residual Learning\nWe present a framework.")
    t = client.post("/api/topics", json={"goal": "g"}).json()
    data = blank_pdf()
    r = upload(client, data, topic_id=str(t["id"]))
    p = r.json()
    assert r.status_code == 200
    assert (p["title"], p["topic_id"], p["has_pdf"]) == ("Deep Residual Learning", t["id"], True)
    assert p["text"].startswith("Deep Residual")
    f = client.get(f"/api/papers/{p['id']}/file")
    assert f.headers["content-type"] == "application/pdf" and f.content == data


def test_upload_prefers_pdf_metadata_title(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "arXiv:1234\nbody")
    p = upload(client, blank_pdf(title="Attention Is All You Need")).json()
    assert p["title"] == "Attention Is All You Need" and p["topic_id"] is None


def test_upload_scanned_pdf_keeps_file_without_text(client):
    p = upload(client, blank_pdf()).json()
    assert (p["title"], p["text"], p["has_pdf"]) == ("my paper", "", True)


def test_upload_rejects_non_pdf(client):
    r = upload(client, b"hello")
    assert r.status_code == 400 and "PDF" in r.json()["detail"]


def test_replacing_pdf_stores_file(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "new text")
    p = client.post("/api/papers", json={"title": "P"}).json()
    assert p["has_pdf"] is False
    assert client.get(f"/api/papers/{p['id']}/file").status_code == 404
    r = client.post(f"/api/papers/{p['id']}/pdf", files={"file": ("p.pdf", blank_pdf(), "application/pdf")}).json()
    assert r["has_pdf"] is True and r["text"] == "new text"


def test_title_from_metadata_ignores_junk():
    assert pdf.guess_title({"/Title": "Microsoft Word - draft.docx"}, "Real Title\nbody", "f") == "Real Title"
    assert pdf.guess_title({}, "", "fallback") == "fallback"
    assert pdf.guess_title({"/Title": "A Good Title"}, "x", "f") == "A Good Title"


def test_title_skips_notices_and_urls():
    text = ("Provided proper attribution is provided, Google grants permission to reproduce this.\n"
            "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023\nAttention Is All You Need\nAshish Vaswani")
    assert pdf.guess_title({}, text, "f") == "Attention Is All You Need"


def test_upload_uses_ai_metadata_when_available(client, monkeypatch):
    from papers import llm
    monkeypatch.setattr(pdf, "extract_text", lambda data: "junk line.\nbody")
    monkeypatch.setattr(llm, "paper_metadata", lambda head: {"title": "Real Title", "authors": "A, B", "year": 2020})
    p = upload(client, blank_pdf()).json()
    assert (p["title"], p["authors"], p["year"]) == ("Real Title", "A, B", 2020)
