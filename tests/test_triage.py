from app import db, llm, pdf
from tests.test_papers import blank_pdf


def make(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


def test_archive_hides_from_lists_but_keeps_searchable(client):
    p = make(client, title="Old Idea")
    client.patch(f"/api/papers/{p['id']}", json={"archived": True})
    assert client.get("/api/papers").json() == []
    assert [x["id"] for x in client.get("/api/papers", params={"archived": 1}).json()] == [p["id"]]
    assert client.get("/api/search", params={"q": "old idea"}).json()[0]["paper"]["archived"] == 1
    client.patch(f"/api/papers/{p['id']}", json={"archived": False})
    assert [x["id"] for x in client.get("/api/papers").json()] == [p["id"]]


def test_delete_removes_everything(client, tmp_path, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Doomed Paper\nbody")
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question: "a")
    root = tmp_path / "Papers"
    client.put("/api/settings", json={"library_dir": str(root)})
    p = client.post("/api/papers/upload", files={"file": ("f.pdf", blank_pdf(), "application/pdf")}).json()
    child = make(client, title="Child", source_paper_id=p["id"])
    client.post(f"/api/papers/{p['id']}/explain", json={"passage": "x"})
    assert (root / "Unsorted" / "Doomed Paper.pdf").exists()
    assert client.delete(f"/api/papers/{p['id']}").status_code == 204
    assert client.get(f"/api/papers/{p['id']}").status_code == 404
    assert not db.pdf_path(p["id"]).exists()
    assert not list((root / "Unsorted").glob("Doomed*"))
    assert client.get(f"/api/papers/{child['id']}").json()["source_paper_id"] is None
    assert client.get("/api/search", params={"q": "doomed"}).json() == []
    with db.connect() as conn:
        assert conn.execute("select count(*) from explanations").fetchone()[0] == 0
    assert client.delete(f"/api/papers/{p['id']}").status_code == 404


def test_bibtex_for_arxiv_and_other_papers(client):
    a = make(client, title="Attention Is All You Need", authors="Ashish Vaswani, Noam Shazeer", year=2017,
             external_id="arXiv:1706.03762", url="https://arxiv.org/abs/1706.03762")
    bib = client.get(f"/api/papers/{a['id']}/bibtex").text
    assert bib.startswith("@misc{vaswani2017attention,")
    assert "author = {Ashish Vaswani and Noam Shazeer}" in bib
    assert "title = {{Attention Is All You Need}}" in bib
    assert "eprint = {1706.03762}" in bib and "archivePrefix = {arXiv}" in bib
    b = make(client, title="A {Weird} Title", year=None, external_id="DOI:10.1/x")
    bib = client.get(f"/api/papers/{b['id']}/bibtex").text
    assert bib.startswith("@article{paperweird,") and "doi = {10.1/x}" in bib and "year" not in bib


def test_bib_file_for_a_goal(client):
    t = client.post("/api/topics", json={"goal": "Retrieval"}).json()
    make(client, title="In Goal", topic_id=t["id"], year=2020, authors="Ann Lee")
    make(client, title="Elsewhere", year=2021)
    r = client.get("/api/bibtex", params={"topic_id": t["id"]})
    assert r.headers["content-disposition"] == 'attachment; filename="Retrieval.bib"'
    assert r.text.count("@") == 1 and "lee2020in" in r.text
    assert client.get("/api/bibtex").text.count("@") == 2
