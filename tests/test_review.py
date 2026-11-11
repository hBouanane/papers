from datetime import date, timedelta

from papers import llm

QUIZ = [{"question": "Q1", "answer": "A1"}, {"question": "Q2", "answer": "A2"}]
day = lambda n: (date.today() + timedelta(days=n)).isoformat()


def finished(client, monkeypatch):
    monkeypatch.setattr(llm, "quiz", lambda paper: QUIZ)
    p = client.post("/api/papers", json={"title": "P"}).json()
    return client.post(f"/api/papers/{p['id']}/finish").json()


def review(client, pid, ratings):
    return client.post(f"/api/papers/{pid}/review", json={"ratings": ratings}).json()


def test_finishing_makes_the_first_review_due_today(client, monkeypatch):
    p = finished(client, monkeypatch)
    assert p["review_due"] == day(0)
    assert [x["id"] for x in client.get("/api/reviews/due").json()] == [p["id"]]


def test_good_reviews_space_out_and_bad_ones_reset(client, monkeypatch):
    p = finished(client, monkeypatch)
    r = review(client, p["id"], [1, 1])
    assert (r["understanding"], r["review_step"], r["review_due"]) == (1, 1, day(3))
    assert client.get("/api/reviews/due").json() == []
    r = review(client, p["id"], [1, 0.5])  # 75%: still good
    assert (r["review_step"], r["review_due"]) == (2, day(7))
    r = review(client, p["id"], [0.5, 0.5])  # 50%: stay
    assert (r["review_step"], r["review_due"]) == (2, day(7))
    r = review(client, p["id"], [0, 0])  # forgot: start over
    assert (r["understanding"], r["review_step"], r["review_due"]) == (0, 0, day(1))


def test_review_needs_a_quiz_and_one_rating_per_question(client, monkeypatch):
    p = client.post("/api/papers", json={"title": "P"}).json()
    assert client.post(f"/api/papers/{p['id']}/review", json={"ratings": [1]}).status_code == 400
    q = finished(client, monkeypatch)
    assert client.post(f"/api/papers/{q['id']}/review", json={"ratings": [1]}).status_code == 400
    assert client.post(f"/api/papers/{q['id']}/review", json={"ratings": [2, 1]}).status_code == 422


def test_ai_grading_also_schedules_the_next_review(client, monkeypatch):
    p = finished(client, monkeypatch)
    monkeypatch.setattr(llm, "grade", lambda paper, quiz, answers: {"results": [], "score": 0.9})
    client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["a", "b"]})
    assert client.get(f"/api/papers/{p['id']}").json()["review_due"] == day(3)


def test_more_questions_are_added_without_repeats(client, monkeypatch):
    p = finished(client, monkeypatch)
    monkeypatch.setattr(llm, "more_questions", lambda paper, existing, count=5: [
        {"question": "q1 ", "answer": "again"}, {"question": "Q3", "answer": "A3"}])
    quiz = client.post(f"/api/papers/{p['id']}/quiz/more").json()
    assert [q["question"] for q in quiz] == ["Q1", "Q2", "Q3"]
    assert len(client.get(f"/api/papers/{p['id']}").json()["quiz"]) == 3
    empty = client.post("/api/papers", json={"title": "No quiz"}).json()
    assert client.post(f"/api/papers/{empty['id']}/quiz/more").status_code == 400


def test_grading_is_one_request_and_skips_blank_answers(client, monkeypatch):
    p = finished(client, monkeypatch)
    calls = []

    def grade(paper, quiz, answers):
        calls.append(([q["question"] for q in quiz], answers))
        return {"results": [{"score": 1, "feedback": "Right."} for _ in quiz], "score": 1}

    monkeypatch.setattr(llm, "grade", grade)
    r = client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["mine", "  "]}).json()
    assert calls == [(["Q1"], ["mine"])]
    assert [x["score"] for x in r["results"]] == [1, 0] and r["score"] == 0.5 and r["questions"] == [0, 1]
    r = client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["", "second"], "only": [1]}).json()
    assert calls[-1] == (["Q2"], ["second"]) and r["questions"] == [1] and len(r["results"]) == 1
    client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["", ""]})
    assert len(calls) == 2


def test_grading_only_new_questions_keeps_the_score_of_the_others(client, monkeypatch):
    p = finished(client, monkeypatch)
    monkeypatch.setattr(llm, "grade", lambda paper, quiz, answers: {"results": [{"score": 1, "feedback": ""} for _ in quiz], "score": 1})
    client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["a", ""]})  # 50%
    client.post(f"/api/papers/{p['id']}/quiz/grade", json={"answers": ["", "b"], "only": [1]})
    assert client.get(f"/api/papers/{p['id']}").json()["understanding"] == 0.75
