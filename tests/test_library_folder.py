from app import library, llm, pdf
from tests.test_papers import blank_pdf


def upload(client, **form):
    return client.post("/api/papers/upload", files={"file": ("f.pdf", blank_pdf(), "application/pdf")}, data=form).json()


def set_folder(client, path):
    return client.put("/api/settings", json={"library_dir": str(path)})


def test_folder_setting_mirrors_existing_papers(client, tmp_path, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "")
    p = upload(client)
    client.patch(f"/api/papers/{p['id']}", json={"title": "Attention: Is All You Need?", "authors": "Ashish Vaswani, Noam Shazeer, Niki Parmar", "year": 2017})
    root = tmp_path / "Papers"
    r = set_folder(client, root)
    assert r.status_code == 200 and r.json()["library_dir"] == str(root)
    name = "Vaswani et al. 2017 - Attention Is All You Need"
    assert (root / "Unsorted" / f"{name}.pdf").read_bytes() == blank_pdf()
    notes = (root / "Unsorted" / f"{name}.md").read_text(encoding="utf-8")
    assert notes.startswith("# Attention: Is All You Need?") and "Ashish Vaswani" in notes
    assert (root / "Inbox").is_dir()


def test_changing_goal_or_title_moves_the_files(client, tmp_path, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "")
    root = tmp_path / "Papers"
    set_folder(client, root)
    p = upload(client)
    client.patch(f"/api/papers/{p['id']}", json={"title": "First", "year": 2020})
    t = client.post("/api/topics", json={"goal": "Dense retrieval / evaluation"}).json()
    client.patch(f"/api/papers/{p['id']}", json={"title": "Second", "topic_id": t["id"]})
    goal_dir = root / "Dense retrieval evaluation"
    assert sorted(f.name for f in goal_dir.iterdir()) == ["2020 - Second.md", "2020 - Second.pdf"]
    assert not list((root / "Unsorted").glob("*"))


def test_notes_include_key_points_explanations_quiz_and_links(client, tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "skim", lambda paper: {"problem": "P", "contributions": ["C"], "method": "M", "results": ["R"],
                                                   "limitations": ["L"], "read_closely": ["S3"], "verdict": "Read it."})
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question, **kw: "Plainly put.")
    monkeypatch.setattr(llm, "quiz", lambda paper: [{"question": "Why?", "answer": "Because."}])
    root = tmp_path / "Papers"
    set_folder(client, root)
    parent = client.post("/api/papers", json={"title": "Parent Paper", "year": 2014}).json()
    p = client.post("/api/papers", json={"title": "Child Paper", "year": 2017, "source_paper_id": parent["id"]}).json()
    client.post(f"/api/papers/{p['id']}/skim")
    client.post(f"/api/papers/{p['id']}/explain", json={"passage": "hard bit", "question": "huh?"})
    client.post(f"/api/papers/{p['id']}/finish")
    notes = (root / "Unsorted" / "2017 - Child Paper.md").read_text(encoding="utf-8")
    for expected in ("Read it.", "> hard bit", "huh?", "Plainly put.", "Why?", "[[2014 - Parent Paper]]"):
        assert expected in notes, expected
    assert "[[2017 - Child Paper]]" in (root / "Unsorted" / "2014 - Parent Paper.md").read_text(encoding="utf-8")


def test_explanations_are_stored_and_listed(client, monkeypatch):
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question, **kw: "Plainly put.")
    p = client.post("/api/papers", json={"title": "P"}).json()
    client.post(f"/api/papers/{p['id']}/explain", json={"passage": "x"})
    items = client.get(f"/api/papers/{p['id']}/explanations").json()
    assert [(i["passage"], i["answer"]) for i in items] == [("x", "Plainly put.")]


def test_inbox_pdfs_are_imported_and_filed(client, tmp_path, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Inbox Paper Title\nbody")
    root = tmp_path / "Papers"
    set_folder(client, root)
    (root / "Inbox" / "download.pdf").write_bytes(blank_pdf())
    (root / "Inbox" / "notes.txt").write_text("ignore me")
    (root / "Inbox" / "broken.pdf").write_bytes(b"not a pdf")
    from app.main import import_inbox
    assert import_inbox() == 1
    assert [p["title"] for p in client.get("/api/papers").json()] == ["Inbox Paper Title"]
    assert not (root / "Inbox" / "download.pdf").exists()
    assert (root / "Unsorted" / "Inbox Paper Title.pdf").exists()
    assert (root / "Inbox" / "broken.pdf").exists() and import_inbox() == 0  # left alone, not retried forever


def test_folder_must_be_absolute_and_can_be_turned_off(client, tmp_path):
    assert set_folder(client, "relative/path").status_code == 400
    assert set_folder(client, "").json()["library_dir"] == ""
    assert library.root() is None


def test_safe_names():
    assert library.safe_name('a<b>:c"/d\\e|f?g*h. ') == "abcdefgh"
    assert len(library.safe_name("x" * 500)) <= 120


def test_paper_name_handles_et_al_and_two_authors():
    assert library.paper_name({"id": 1, "title": "T", "authors": "Vaswani et al.", "year": 2017}) == "Vaswani et al. 2017 - T"
    assert library.paper_name({"id": 1, "title": "T", "authors": "Kyunghyun Cho, Yoshua Bengio", "year": None}) == "Cho and Bengio - T"


def test_inbox_pdf_for_a_known_paper_attaches_instead_of_duplicating(client, tmp_path, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Known Paper\nbody")
    root = tmp_path / "Papers"
    set_folder(client, root)
    known = client.post("/api/papers", json={"title": "Known Paper"}).json()
    (root / "Inbox" / "k.pdf").write_bytes(blank_pdf())
    from app.main import import_inbox
    assert import_inbox() == 1
    papers = client.get("/api/papers").json()
    assert [p["id"] for p in papers] == [known["id"]]
    assert client.get(f"/api/papers/{known['id']}").json()["has_pdf"] is True
