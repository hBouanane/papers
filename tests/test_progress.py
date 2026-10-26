from app import llm


def make_paper(client):
    return client.post("/api/papers", json={"title": "P"}).json()


def put(client, pid, position):
    return client.put(f"/api/papers/{pid}/progress", json={"position": position}).json()


def test_moving_without_reading_updates_position_only(client):
    p = make_paper(client)
    r = put(client, p["id"], 0.6)
    assert (r["position"], r["progress"], r["status"]) == (0.6, 0, "reading")
    assert put(client, p["id"], 5)["position"] == 1


def test_finish_marks_read_and_generates_quiz(client, monkeypatch):
    monkeypatch.setattr(llm, "quiz", lambda paper: [{"question": "Q", "answer": "A"}])
    p = make_paper(client)
    r = client.post(f"/api/papers/{p['id']}/finish").json()
    assert r["status"] == "read" and r["progress"] == 1 and r["quiz"] == [{"question": "Q", "answer": "A"}]
    assert put(client, p["id"], 0.1)["status"] == "read"


def test_list_shows_where_reading_stopped(client):
    text = "First sentence here. " * 20 + "The resume point is right here and continues. " + "Tail text. " * 20
    p = client.post("/api/papers", json={"title": "P"}).json()
    from app.main import update_paper
    update_paper(p["id"], text=text)
    put(client, p["id"], text.index("The resume") / len(text))
    row = client.get("/api/papers").json()[0]
    assert row["resume_text"].startswith("The resume point")
    assert len(row["resume_text"]) <= 200
