from app import library, llm


def make(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


def test_notes_are_saved_and_written_to_the_folder(client, tmp_path):
    root = tmp_path / "Papers"
    client.put("/api/settings", json={"library_dir": str(root)})
    p = make(client, title="Noted")
    r = client.patch(f"/api/papers/{p['id']}", json={"notes": "  Key idea: X.\nCompare with Y.  "})
    assert r.json()["notes"] == "  Key idea: X.\nCompare with Y.  "
    md = (root / "Unsorted" / "Noted.md").read_text(encoding="utf-8")
    assert "## My notes\n\n  Key idea: X.\nCompare with Y." in md


def test_notes_edited_in_the_file_come_back_into_the_app(client, tmp_path):
    root = tmp_path / "Papers"
    client.put("/api/settings", json={"library_dir": str(root)})
    p = make(client, title="Noted")
    client.patch(f"/api/papers/{p['id']}", json={"notes": "from the app"})
    md = root / "Unsorted" / "Noted.md"
    md.write_text(md.read_text(encoding="utf-8").replace("from the app", "edited in Obsidian\n- point"), encoding="utf-8")
    assert library.import_notes() == 1
    assert client.get(f"/api/papers/{p['id']}").json()["notes"] == "edited in Obsidian\n- point"
    assert library.import_notes() == 0  # nothing new
    # an app edit afterwards still wins
    client.patch(f"/api/papers/{p['id']}", json={"notes": "app again"})
    assert "app again" in md.read_text(encoding="utf-8") and library.import_notes() == 0


def test_ask_about_the_paper_without_a_passage(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question: seen.update(p=passage, q=question) or "answer")
    p = make(client)
    r = client.post(f"/api/papers/{p['id']}/explain", json={"question": "How does it differ from DDPM?"})
    assert r.json() == {"explanation": "answer"} and seen == {"p": "", "q": "How does it differ from DDPM?"}
    assert client.post(f"/api/papers/{p['id']}/explain", json={"passage": " ", "question": ""}).status_code == 400


def test_recall_searches_unfinished_papers_notes_and_explanations(client, monkeypatch):
    monkeypatch.setattr(llm, "recall", lambda idea, cands: [{"paper_id": c["id"], "reason": "r"} for c in cands])
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question: "it is about contrastive pretraining")
    skimmed = make(client, title="Unread One")
    noted = make(client, title="Noted One")
    explained = make(client, title="Explained One")
    client.patch(f"/api/papers/{noted['id']}", json={"notes": "reminds me of momentum encoders"})
    client.post(f"/api/papers/{explained['id']}/explain", json={"passage": "x"})
    from app.main import update_paper
    update_paper(skimmed["id"], text="we use momentum encoders and contrastive pretraining")
    ids = lambda idea: [m["paper"]["id"] for m in client.post("/api/recall", json={"idea": idea}).json()]
    assert set(ids("momentum encoders")) == {skimmed["id"], noted["id"]}
    assert set(ids("contrastive pretraining")) == {skimmed["id"], explained["id"]}


def test_recall_falls_back_to_keywords_without_ai(client):
    p = make(client, title="Diffusion")
    from app.main import update_paper
    update_paper(p["id"], text="we gradually add gaussian noise and learn to reverse it")
    found = client.post("/api/recall", json={"idea": "reverse the gaussian noise"}).json()
    assert [m["paper"]["id"] for m in found] == [p["id"]]
    assert "noise" in found[0]["reason"].lower()
