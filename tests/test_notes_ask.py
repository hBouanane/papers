from papers import llm


def make(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


def test_ask_about_the_paper_without_a_passage(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question, **kw: seen.update(p=passage, q=question) or "answer")
    p = make(client)
    r = client.post(f"/api/papers/{p['id']}/explain", json={"question": "How does it differ from DDPM?"})
    assert r.json() == {"explanation": "answer"} and seen == {"p": "", "q": "How does it differ from DDPM?"}
    assert client.post(f"/api/papers/{p['id']}/explain", json={"passage": " ", "question": ""}).status_code == 400


def test_recall_searches_unfinished_papers_notes_and_explanations(client, monkeypatch):
    monkeypatch.setattr(llm, "recall", lambda idea, cands: [{"paper_id": c["id"], "reason": "r"} for c in cands])
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question, **kw: "it is about contrastive pretraining")
    skimmed = make(client, title="Unread One")
    noted = make(client, title="Noted One")
    explained = make(client, title="Explained One")
    client.post(f"/api/papers/{noted['id']}/notes", json={"body": "reminds me of momentum encoders"})
    client.post(f"/api/papers/{explained['id']}/explain", json={"passage": "x"})
    from papers.store import update_paper
    update_paper(skimmed["id"], text="we use momentum encoders and contrastive pretraining")
    ids = lambda idea: [m["paper"]["id"] for m in client.post("/api/recall", json={"idea": idea}).json()]
    assert set(ids("momentum encoders")) == {skimmed["id"], noted["id"]}
    assert set(ids("contrastive pretraining")) == {skimmed["id"], explained["id"]}


def test_recall_falls_back_to_keywords_without_ai(client):
    p = make(client, title="Diffusion")
    from papers.store import update_paper
    update_paper(p["id"], text="we gradually add gaussian noise and learn to reverse it")
    found = client.post("/api/recall", json={"idea": "reverse the gaussian noise"}).json()
    assert [m["paper"]["id"] for m in found] == [p["id"]]
    assert "noise" in found[0]["reason"].lower()
