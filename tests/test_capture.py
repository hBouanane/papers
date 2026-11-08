from app import llm, pdf
from tests.test_papers import blank_pdf

SKIM = {"problem": "p", "contributions": [], "method": "m", "results": [], "limitations": [], "read_closely": [], "verdict": "v"}


def upload(client, **form):
    return client.post("/api/papers/upload", files={"file": ("f.pdf", blank_pdf(), "application/pdf")}, data=form).json()


def test_upload_of_known_paper_attaches_to_it(client, monkeypatch):
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Known Paper\nbody text")
    t = client.post("/api/topics", json={"goal": "g"}).json()
    known = client.post("/api/papers", json={"title": "Known Paper"}).json()
    p = upload(client, topic_id=str(t["id"]))
    assert p["id"] == known["id"] and p["has_pdf"] and p["text"] == "Known Paper\nbody text" and p["topic_id"] == t["id"]
    assert len(client.get("/api/papers").json()) == 1


def test_new_papers_are_skimmed_in_the_background_when_ai_is_configured(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(llm, "skim", lambda paper: SKIM)
    monkeypatch.setattr(llm, "paper_metadata", lambda head: {"title": "Fresh", "authors": "", "year": None})
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Fresh\nbody")
    p = upload(client)
    got = client.get(f"/api/papers/{p['id']}").json()
    assert got["skim"] == SKIM and got["status"] == "new"


def test_no_background_skim_without_ai_or_text(client, monkeypatch):
    called = []
    monkeypatch.setattr(llm, "skim", lambda paper: called.append(1) or SKIM)
    monkeypatch.setattr(pdf, "extract_text", lambda data: "Some Title\nbody")
    upload(client)  # no API key
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    client.post("/api/papers", json={"title": "No text"})
    assert called == []


def test_background_skim_failure_is_harmless(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(llm, "paper_metadata", lambda head: {"title": "T", "authors": "", "year": None})

    def boom(paper):
        raise llm.AIError("down")

    monkeypatch.setattr(llm, "skim", boom)
    monkeypatch.setattr(pdf, "extract_text", lambda data: "T\nbody")
    p = upload(client)
    assert client.get(f"/api/papers/{p['id']}").json()["skim"] is None
