import pytest

from app import pdf, scholar
from tests.test_papers import blank_pdf

META = {"external_id": "arXiv:1706.03762", "title": "Attention Is All You Need", "authors": "Ashish Vaswani",
        "year": 2017, "abstract": "abs", "url": "https://arxiv.org/abs/1706.03762", "pdf_url": "https://arxiv.org/pdf/1706.03762"}


@pytest.mark.parametrize("link, ident", [
    ("https://arxiv.org/abs/1706.03762", "arXiv:1706.03762"),
    ("https://arxiv.org/abs/1706.03762v7", "arXiv:1706.03762"),
    ("arxiv.org/pdf/1706.03762v2.pdf", "arXiv:1706.03762"),
    ("1706.03762", "arXiv:1706.03762"),
    ("arXiv:2101.00001", "arXiv:2101.00001"),
    ("https://arxiv.org/abs/hep-th/9901001", "arXiv:hep-th/9901001"),
    ("https://doi.org/10.1145/3292500.3330701", "DOI:10.1145/3292500.3330701"),
    ("10.18653/v1/N19-1423", "DOI:10.18653/v1/N19-1423"),
    ("https://www.semanticscholar.org/paper/Attention-is-All-you-Need-Vaswani/204e3073870fae3d05bcbc2f6a8e263d9b72e776",
     "204e3073870fae3d05bcbc2f6a8e263d9b72e776"),
    ("https://example.com/paper.pdf", None),
    ("not a link", None),
])
def test_parse_link(link, ident):
    assert scholar.parse_link(link) == ident


def add(client, link, **extra):
    return client.post("/api/papers/from-link", json={"link": link, **extra})


def test_add_from_arxiv_link_downloads_pdf(client, monkeypatch):
    monkeypatch.setattr(scholar, "lookup", lambda ident: dict(META) if ident == "arXiv:1706.03762" else None)
    monkeypatch.setattr(scholar, "fetch_pdf", lambda url: blank_pdf())
    monkeypatch.setattr(pdf, "extract_text", lambda data: "full text")
    t = client.post("/api/topics", json={"goal": "g"}).json()
    p = add(client, "https://arxiv.org/abs/1706.03762v7", topic_id=t["id"]).json()
    assert (p["title"], p["topic_id"], p["has_pdf"], p["text"]) == ("Attention Is All You Need", t["id"], True, "full text")


def test_adding_same_link_twice_returns_existing_paper(client, monkeypatch):
    monkeypatch.setattr(scholar, "lookup", lambda ident: dict(META))
    first = add(client, "1706.03762").json()
    second = add(client, "https://arxiv.org/pdf/1706.03762").json()
    assert second["id"] == first["id"]
    assert len(client.get("/api/papers").json()) == 1


def test_unknown_identifier_is_404(client, monkeypatch):
    monkeypatch.setattr(scholar, "lookup", lambda ident: None)
    r = add(client, "10.1234/nothing")
    assert r.status_code == 404 and "find" in r.json()["detail"]


def test_add_from_direct_pdf_link(client, monkeypatch):
    monkeypatch.setattr(scholar, "fetch_pdf", lambda url: blank_pdf())
    monkeypatch.setattr(pdf, "extract_text", lambda data: "My Great Paper Title\nbody")
    p = add(client, "https://example.com/files/paper.pdf").json()
    assert (p["title"], p["has_pdf"], p["url"]) == ("My Great Paper Title", True, "https://example.com/files/paper.pdf")


def test_link_that_is_not_a_paper_is_400(client, monkeypatch):
    monkeypatch.setattr(scholar, "fetch_pdf", lambda url: b"<html>")
    assert add(client, "https://example.com/blog").status_code == 400
    assert add(client, "hello there").status_code == 400
