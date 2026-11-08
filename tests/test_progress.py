from app import llm


def make_paper(client):
    return client.post("/api/papers", json={"title": "P"}).json()


def put(client, pid, position):
    return client.put(f"/api/papers/{pid}/progress", json={"position": position}).json()


def test_progress_tracks_position_and_furthest_point(client):
    p = make_paper(client)
    r = put(client, p["id"], 0.6)
    assert (r["position"], r["progress"], r["status"]) == (0.6, 0.6, "reading")
    r = put(client, p["id"], 0.2)
    assert (r["position"], r["progress"]) == (0.2, 0.6)
    assert put(client, p["id"], 5)["progress"] == 1


def test_finish_marks_read_and_generates_quiz(client, monkeypatch):
    monkeypatch.setattr(llm, "quiz", lambda paper: [{"question": "Q", "answer": "A"}])
    p = make_paper(client)
    r = client.post(f"/api/papers/{p['id']}/finish").json()
    assert r["status"] == "read" and r["progress"] == 1 and r["quiz"] == [{"question": "Q", "answer": "A"}]
    assert put(client, p["id"], 0.1)["status"] == "read"
