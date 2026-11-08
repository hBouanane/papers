import pytest

from app import llm

SKIM = {"problem": "p", "contributions": ["c"], "method": "m", "results": ["r"],
        "limitations": ["l"], "read_closely": ["Sec 3"], "verdict": "read"}
QUIZ = [{"question": "Q1?", "answer": "A1"}, {"question": "Q2?", "answer": "A2"}]


def make_paper(client):
    return client.post("/api/papers", json={"title": "P", "abstract": "abs"}).json()


def test_skim_stores_result_and_marks_skimmed(client, monkeypatch):
    monkeypatch.setattr(llm, "skim", lambda paper, **kw: SKIM)
    p = make_paper(client)
    assert client.post(f"/api/papers/{p['id']}/skim").json() == SKIM
    got = client.get(f"/api/papers/{p['id']}").json()
    assert got["skim"] == SKIM and got["status"] == "skimmed"


def test_explain_gets_full_paper(client, monkeypatch):
    seen = {}

    def fake(paper, passage, question, **kw):
        seen.update(title=paper["title"], passage=passage, question=question)
        return "simple words"

    monkeypatch.setattr(llm, "explain", fake)
    p = make_paper(client)
    r = client.post(f"/api/papers/{p['id']}/explain", json={"passage": "hard bit"}).json()
    assert r == {"explanation": "simple words"}
    assert seen == {"title": "P", "passage": "hard bit", "question": ""}


def test_quiz_generate_and_grade(client, monkeypatch):
    monkeypatch.setattr(llm, "quiz", lambda paper: QUIZ)
    monkeypatch.setattr(llm, "grade", lambda paper, quiz, answers: {
        "results": [{"score": 1.0, "feedback": "ok"}, {"score": 0.0, "feedback": "no"}], "score": 0.5})
    p = make_paper(client)
    assert client.post(f"/api/papers/{p['id']}/quiz").json() == QUIZ
    r = client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["A1", "x"]}).json()
    assert r["score"] == 0.5
    assert client.get(f"/api/papers/{p['id']}").json()["understanding"] == 0.5


def test_grade_without_quiz_is_400(client):
    p = make_paper(client)
    assert client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": []}).status_code == 400


def test_grade_averages_scores(monkeypatch):
    monkeypatch.setattr(llm, "_parse", lambda prompt, schema, **kw: llm.Grades(results=[
        llm.GradeItem(score=1, feedback="a"), llm.GradeItem(score=0.5, feedback="b")]))
    r = llm.grade({"title": "P"}, QUIZ, ["x", "y"])
    assert r["score"] == 0.75 and len(r["results"]) == 2


@pytest.mark.llm_plumbing
def test_ai_errors_become_503(client, monkeypatch):
    def fail(**kw):
        raise TypeError("Could not resolve authentication method")

    class Fake:
        class messages:
            parse = staticmethod(fail)
            create = staticmethod(fail)

    monkeypatch.setattr(llm, "_client", lambda: Fake)
    p = make_paper(client)
    r = client.post(f"/api/papers/{p['id']}/skim")
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    assert client.post(f"/api/papers/{p['id']}/explain", json={"passage": "x"}).status_code == 503
