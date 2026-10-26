from app import llm


def make(client):
    return client.post("/api/papers", json={"title": "P"}).json()


def put(client, pid, **body):
    return client.put(f"/api/papers/{pid}/progress", json=body).json()


def test_progress_counts_only_slices_actually_read(client):
    p = make(client)
    r = put(client, p["id"], position=0.05, slices=[0, 1, 2, 3, 4])
    assert (r["progress"], r["position"], r["status"]) == (0.05, 0.05, "reading")
    # jumping to the end and reading two slices there doesn't make the paper 97% read
    r = put(client, p["id"], position=0.99, slices=[97, 98])
    assert r["progress"] == 0.07 and r["position"] == 0.99
    assert r["read_slices"][:5] == "11111" and r["read_slices"][97:99] == "11" and r["read_slices"].count("1") == 7


def test_rereading_does_not_double_count(client):
    p = make(client)
    put(client, p["id"], position=0.1, slices=[0, 1, 2])
    assert put(client, p["id"], position=0.1, slices=[1, 2, 2, 150, -1])["progress"] == 0.03


def test_skim_mode_records_nothing_but_marks_new_papers_skimmed(client):
    p = make(client)
    r = put(client, p["id"], position=0.8, mode="skim")
    assert (r["status"], r["progress"], r["position"]) == ("skimmed", 0, 0)
    put(client, p["id"], position=0.2, slices=[10])
    assert put(client, p["id"], position=0.9, mode="skim")["status"] == "reading"


def test_legacy_progress_kept_until_slices_catch_up(client):
    p = make(client)
    from app.main import update_paper
    update_paper(p["id"], progress=0.5, status="reading")
    assert put(client, p["id"], position=0.1, slices=[0])["progress"] == 0.5


def test_list_includes_read_slices(client):
    p = make(client)
    put(client, p["id"], position=0.01, slices=[0])
    assert client.get("/api/papers").json()[0]["read_slices"].startswith("1")


def test_finish_marks_everything_read_even_without_ai(client, monkeypatch):
    def no_ai(paper):
        raise llm.AIError("Claude is not configured")

    monkeypatch.setattr(llm, "quiz", no_ai)
    p = make(client)
    r = client.post(f"/api/papers/{p['id']}/finish").json()
    assert (r["status"], r["progress"], r["read_slices"], r["quiz"]) == ("read", 1, "1" * 100, None)
