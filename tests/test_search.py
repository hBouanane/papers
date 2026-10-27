from app import index, llm
from app.main import update_paper


def make(client, title, authors="", text=""):
    p = client.post("/api/papers", json={"title": title, "authors": authors}).json()
    if text:
        update_paper(p["id"], text=text)
    return p


def search(client, q):
    return client.get("/api/search", params={"q": q}).json()


def test_search_by_title_author_and_full_text(client):
    a = make(client, "Attention Is All You Need", "Ashish Vaswani")
    b = make(client, "Deep Residual Learning", "Kaiming He", text="We use batch normalization after each convolution.")
    assert [r["paper"]["id"] for r in search(client, "vaswani")] == [a["id"]]
    assert [r["paper"]["id"] for r in search(client, "residual")] == [b["id"]]
    hit = search(client, "normaliz")  # prefix of a word in the body
    assert [r["paper"]["id"] for r in hit] == [b["id"]]
    assert "normalization" in hit[0]["snippet"]


def test_search_needs_every_word_and_handles_punctuation(client):
    make(client, "Attention Is All You Need")
    make(client, "Attention Gates")
    assert len(search(client, "attention")) == 2
    assert len(search(client, 'attention "need"')) == 1
    assert search(client, "   ") == []


def test_unfinished_papers_are_searchable_and_recalled(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(llm, "recall", lambda idea, cands: seen.setdefault("c", cands) and [])
    p = make(client, "Unread", text="diffusion models add noise")
    assert len(search(client, "diffusion")) == 1
    client.post("/api/recall", json={"idea": "diffusion noise"})
    assert [c["id"] for c in seen["c"]] == [p["id"]]


def test_backfill_indexes_existing_papers(client):
    p = make(client, "Old Paper", text="legacy content")
    from app import db
    with db.connect() as conn:
        conn.execute("delete from papers_fts")
    index.backfill()
    assert [r["paper"]["id"] for r in search(client, "legacy")] == [p["id"]]
