"""Claude reads a new paper ahead of time, so key points, vocabulary, review questions and
references are ready when the reader gets there, and nothing is generated twice."""
from app import llm, pdf, scholar
from tests.test_papers import blank_pdf

SKIM = {"tldr": "t", "problem": "p", "key_idea": "k", "contributions": [], "method": "m", "results": [],
        "limitations": [], "figures": [], "questions": [], "reading_plan": [], "relevance": "", "verdict": "v"}
WORDS = [{"term": "albeit", "kind": "english", "meaning": "although", "example": "e", "translation": ""}]
QUIZ = [{"question": "Q", "answer": "A"}]
REFS = [{"title": "Cited", "authors": "A", "year": 2000}]


def fake_ai(monkeypatch, calls):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(llm, "skim", lambda paper, **kw: calls.append(("skim", kw.get("goal"))) or SKIM)
    monkeypatch.setattr(llm, "glossary", lambda paper, **kw: calls.append(("glossary",)) or WORDS)
    monkeypatch.setattr(llm, "quiz", lambda paper: calls.append(("quiz",)) or QUIZ)
    monkeypatch.setattr(llm, "extract_references", lambda section: calls.append(("refs",)) or REFS)
    monkeypatch.setattr(llm, "paper_metadata", lambda head: {"title": "Prepared Paper", "authors": "", "year": None})
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Intro text.\nReferences\n[1] A. Cited. 2000.")


def upload(client, **form):
    return client.post("/api/papers/upload", files={"file": ("f.pdf", blank_pdf(), "application/pdf")}, data=form).json()


def test_adding_a_paper_prepares_everything_in_the_background(client, monkeypatch):
    calls = []
    fake_ai(monkeypatch, calls)
    t = client.post("/api/topics", json={"goal": "Understand attention for my thesis"}).json()
    p = client.get(f"/api/papers/{upload(client, topic_id=str(t['id']))['id']}").json()
    assert (p["skim"], p["glossary"], p["quiz"]) == (SKIM, WORDS, QUIZ)
    assert p["refs"][0]["title"] == "Cited"
    assert (p["status"], p["review_due"], p["preparing"]) == ("new", None, False)
    assert ("skim", "Understand attention for my thesis") in calls  # the goal shapes the key points


def test_prepare_only_fills_what_is_missing(client, monkeypatch):
    calls = []
    fake_ai(monkeypatch, calls)
    p = upload(client)
    calls.clear()
    client.post(f"/api/papers/{p['id']}/prepare")
    assert calls == []


def test_nothing_is_prepared_without_claude(client, monkeypatch):
    calls = []
    fake_ai(monkeypatch, calls)
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    p = upload(client)
    assert calls == [] and client.get(f"/api/papers/{p['id']}").json()["skim"] is None


def test_finishing_reuses_prepared_questions(client, monkeypatch):
    calls = []
    fake_ai(monkeypatch, calls)
    p = upload(client)
    calls.clear()
    done = client.post(f"/api/papers/{p['id']}/finish").json()
    assert done["quiz"] == QUIZ and done["status"] == "read" and calls == []


def test_semantic_scholar_references_are_cached(client, monkeypatch):
    seen = []
    monkeypatch.setattr(scholar, "references", lambda eid: seen.append(eid) or [{"external_id": "r", "title": "R"}])
    p = client.post("/api/papers", json={"title": "P", "external_id": "s2id"}).json()
    for _ in range(2):
        assert [r["title"] for r in client.get(f"/api/papers/{p['id']}/references").json()] == ["R"]
    assert seen == ["s2id"]


def test_main_text_end_is_where_the_references_start(client):
    p = client.post("/api/papers", json={"title": "P"}).json()
    from app.main import update_paper
    text = "x" * 80 + "\nReferences\n" + "y" * 18
    update_paper(p["id"], text=text)
    assert round(client.get(f"/api/papers/{p['id']}").json()["main_end"], 2) == round(81 / len(text), 2)
    update_paper(p["id"], text="no heading at all")
    assert client.get(f"/api/papers/{p['id']}").json()["main_end"] == 1
