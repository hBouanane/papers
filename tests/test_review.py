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
