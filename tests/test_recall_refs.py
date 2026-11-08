from app import index, llm, scholar


def make_paper(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


def test_finish_indexes_and_recall_finds_paper(client, monkeypatch):
    monkeypatch.setattr(llm, "quiz", lambda paper: [])
    seen = {}

    def fake_recall(idea, candidates):
        seen["ids"] = [c["id"] for c in candidates]
        return [{"paper_id": candidates[0]["id"], "reason": "talks about it"}]

    monkeypatch.setattr(llm, "recall", fake_recall)
    a = make_paper(client, title="Attention", abstract="transformers use self attention")
    b = make_paper(client, title="Convnets", abstract="convolutions for images")
    for p in (a, b):
        client.post(f"/api/papers/{p['id']}/finish")
    r = client.post("/api/recall", json={"idea": "the self attention idea"}).json()
    assert seen["ids"] == [a["id"]]
    assert r == [{"paper": {"id": a["id"], "title": "Attention", "authors": "", "year": None,
                            "status": "read"}, "reason": "talks about it"}]


def test_recall_falls_back_to_read_papers_and_skips_unknown_ids(client, monkeypatch):
    monkeypatch.setattr(llm, "quiz", lambda paper: [])
    monkeypatch.setattr(llm, "recall", lambda idea, cands: [{"paper_id": 999, "reason": "x"}])
    p = make_paper(client, abstract="something")
    client.post(f"/api/papers/{p['id']}/finish")
    assert client.post("/api/recall", json={"idea": "zzz qqq"}).json() == []


def test_fts_query_ignores_punctuation():
    assert index.fts_query('what is "self-attention"?') == '"what" OR "self" OR "attention"'


def test_references_marks_papers_in_library(client, monkeypatch):
    monkeypatch.setattr(scholar, "references", lambda eid: [
        {"external_id": "r1", "title": "R1"}, {"external_id": "r2", "title": "R2"}])
    p = make_paper(client, external_id="p1")
    r1 = make_paper(client, title="R1", external_id="r1", source_paper_id=p["id"])
    refs = client.get(f"/api/papers/{p['id']}/references").json()
    assert [(x["external_id"], x["library_id"]) for x in refs] == [("r1", r1["id"]), ("r2", None)]
    assert client.get(f"/api/papers/{r1['id']}/references").status_code == 200
    assert client.get(f"/api/papers/{make_paper(client)['id']}/references").status_code == 400


def test_chain_shows_ancestors_and_children(client):
    root = make_paper(client, title="Root")
    mid = make_paper(client, title="Mid", source_paper_id=root["id"])
    leaf = make_paper(client, title="Leaf", source_paper_id=mid["id"])
    chain = client.get(f"/api/papers/{mid['id']}/chain").json()
    assert [p["title"] for p in chain["path"]] == ["Root", "Mid"]
    assert [p["id"] for p in chain["children"]] == [leaf["id"]]
