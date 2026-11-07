import io

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app import llm, pdf
from app.main import update_paper


def make(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


PAPER_TEXT = """A Great Paper
Ada Lovelace
Abstract
We propose a new way to read papers. It explains every passage in plain words, keeps
track of what was really read, and turns each paper into short reviews, so that the
ideas stay. Experiments with forty readers show it halves the time to understand a
paper while improving recall a week later.
1 Introduction
Reading papers is hard."""


def test_abstract_is_taken_from_the_paper_itself(client):
    assert pdf.abstract_from(PAPER_TEXT).startswith("We propose a new way to read papers.")
    assert "Introduction" not in pdf.abstract_from(PAPER_TEXT)
    assert pdf.abstract_from("No such section here.") == ""
    p = make(client, abstract="A shorter summary from the search engine.")
    update_paper(p["id"], text=PAPER_TEXT)
    got = client.get(f"/api/papers/{p['id']}").json()
    assert got["paper_abstract"].startswith("We propose") and got["abstract_from_paper"] is True
    q = make(client, abstract="Only the search engine's abstract.")
    assert client.get(f"/api/papers/{q['id']}").json()["paper_abstract"] == "Only the search engine's abstract."


def test_regenerate_redoes_the_chosen_parts_with_the_current_model(client, monkeypatch):
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "skim", lambda p, goal="": {"verdict": "new verdict"})
    monkeypatch.setattr(llm, "glossary", lambda p, language="": [{"term": "new", "kind": "technical", "meaning": "m"}])
    monkeypatch.setattr(llm, "quiz", lambda p: [{"question": "q", "answer": "a"}])
    p = make(client)
    update_paper(p["id"], text=PAPER_TEXT, skim='{"verdict": "old"}', glossary="[]", quiz="[]", refs="[]")
    assert client.post(f"/api/papers/{p['id']}/prepare", json={"redo": ["skim", "glossary"]}).status_code == 200
    got = client.get(f"/api/papers/{p['id']}").json()
    assert got["skim"] == {"verdict": "new verdict"} and got["glossary"][0]["term"] == "new"
    assert got["quiz"] == []  # not asked for, so kept
    assert client.post(f"/api/papers/{p['id']}/prepare", json={"redo": ["nonsense"]}).status_code == 422


def pdf_with_a_figure() -> bytes:
    """One page: a paragraph, a blue box (a vector drawing) and its caption under it."""
    w = PdfWriter()
    page = w.add_blank_page(612, 792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): w._add_object(font)})})
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 10 Tf 72 720 Td (Some running text of the paper, long enough to be a line of prose here.) Tj ET "
                     b"0 0 1 rg 150 450 300 200 re f 0 g "
                     b"BT /F1 10 Tf 150 430 Td (Figure 1: A blue box standing in for a diagram.) Tj ET")
    page[NameObject("/Contents")] = w._add_object(content)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def test_figures_are_cut_out_with_their_captions(client):
    p = make(client)
    client.post(f"/api/papers/{p['id']}/pdf", files={"file": ("p.pdf", pdf_with_a_figure(), "application/pdf")})
    figs = client.get(f"/api/papers/{p['id']}/figures").json()
    assert [(f["number"], f["page"], f["caption"]) for f in figs] == [(1, 1, "Figure 1: A blue box standing in for a diagram.")]
    img = client.get(figs[0]["url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content[:4] == b"\x89PNG"
    # a new PDF replaces them
    client.post(f"/api/papers/{p['id']}/pdf", files={"file": ("p.pdf", pdf_with_a_figure(), "application/pdf")})
    assert len(client.get(f"/api/papers/{p['id']}/figures").json()) == 1


def test_no_pdf_no_figures(client):
    p = make(client)
    assert client.get(f"/api/papers/{p['id']}/figures").json() == []
    assert client.get(f"/api/papers/{p['id']}/figures/1.png").status_code == 404
