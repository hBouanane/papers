"""A goal's reading roadmap: searched papers ordered into stages by the AI, chosen ones added to the goal."""
import pytest

from papers import llm, roadmap, scholar


def found(n):
    return [{"external_id": f"s2-{i}", "title": f"Paper {i}", "authors": "A. Author", "year": 2020 + i,
             "abstract": "About it.", "url": "", "pdf_url": f"https://example.org/{i}.pdf" if i % 2 else "",
             "citations": 100 * i} for i in range(1, n + 1)]


@pytest.fixture
def goal(client, monkeypatch):
    monkeypatch.setattr(llm, "search_queries", lambda goal: ["dense retrieval"])
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: found(5))
    return client.post("/api/topics", json={"goal": "Understand dense retrieval"}).json()["id"]


def test_the_ai_orders_papers_into_stages(client, goal, monkeypatch):
    plan = roadmap.Plan(intro="Start broad, then go deep.", stages=[
        roadmap.Stage(title="The basics", why="First", papers=[roadmap.Pick(number=3, reason="A survey.", minutes=40)]),
        roadmap.Stage(title="Core", why="Then", papers=[roadmap.Pick(number=1, reason="The method.", minutes=30),
                                                        roadmap.Pick(number=99, reason="not a candidate", minutes=1)]),
    ])
    monkeypatch.setattr(roadmap, "plan_with_ai", lambda goal, found: plan)
    r = client.post(f"/api/topics/{goal}/roadmap").json()
    assert [s["title"] for s in r["stages"]] == ["The basics", "Core"]
    assert [i["title"] for i in r["stages"][1]["items"]] == ["Paper 1"]  # number 99 is dropped
    assert {p["title"] for p in r["others"]} == {"Paper 2", "Paper 4", "Paper 5"}
    assert client.get(f"/api/topics/{goal}/roadmap").json()["intro"] == "Start broad, then go deep."


def test_without_an_ai_the_most_cited_are_suggested(client, goal, monkeypatch):
    def no_ai(goal, found):
        raise llm.AIError("no model")
    monkeypatch.setattr(roadmap, "plan_with_ai", no_ai)
    r = client.post(f"/api/topics/{goal}/roadmap").json()
    assert r["by_ai"] is False and r["stages"][0]["items"][0]["title"] == "Paper 5"


def test_adding_puts_papers_in_the_goal_and_fetches_their_pdfs(client, goal, monkeypatch):
    monkeypatch.setattr(roadmap, "plan_with_ai", lambda goal, found: roadmap.Plan(intro="", stages=[
        roadmap.Stage(title="All", why="", papers=[roadmap.Pick(number=1, reason="", minutes=20),
                                                   roadmap.Pick(number=2, reason="", minutes=20)])]))
    fetched = []
    monkeypatch.setattr(scholar, "fetch_pdf", lambda url: fetched.append(url) or b"not a pdf")
    client.post(f"/api/topics/{goal}/roadmap")
    r = client.post(f"/api/topics/{goal}/roadmap/add", json={"papers": ["s2-1", "s2-2"]}).json()
    assert r["added"] == 2
    papers = client.get(f"/api/papers?topic_id={goal}").json()
    assert {p["title"] for p in papers} == {"Paper 1", "Paper 2"}
    assert fetched == ["https://example.org/1.pdf"]  # only Paper 1 has a free PDF
    assert all(i["paper_id"] for i in r["stages"][0]["items"])
    # Adding again doesn't make copies.
    assert client.post(f"/api/topics/{goal}/roadmap/add", json={"papers": ["s2-1"]}).json()["added"] == 0


def test_a_goal_can_be_renamed_and_removed_keeping_its_papers(client):
    g = client.post("/api/topics", json={"goal": "Old words"}).json()
    p = client.post("/api/papers", json={"title": "P", "topic_id": g["id"]}).json()
    assert client.patch(f"/api/topics/{g['id']}", json={"goal": " New words "}).json()["goal"] == "New words"
    assert client.patch(f"/api/topics/{g['id']}", json={"goal": "  "}).status_code == 400
    assert client.delete(f"/api/topics/{g['id']}").json() == {"papers_kept": 1}
    assert client.get(f"/api/papers/{p['id']}").json()["topic_id"] is None
    assert client.get("/api/topics").json() == []
    assert client.delete(f"/api/topics/{g['id']}").status_code == 404


def test_the_classics_are_looked_up_by_title_and_come_first(monkeypatch):
    classic = {"external_id": "arXiv:1706.03762", "title": "Attention Is All You Need", "authors": "", "year": 2017,
               "abstract": "", "url": "", "pdf_url": ""}
    monkeypatch.setattr(llm, "search_queries", lambda goal: ["attention mechanism"])
    monkeypatch.setattr(llm, "landmark_titles", lambda goal: ["Attention Is All You Need", "A Paper Nobody Wrote"])
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: found(3))  # the keyword search misses the classic
    monkeypatch.setattr(scholar, "search_arxiv", lambda q, limit=10, title=False: [classic] if "All You Need" in q else [])
    got = roadmap.candidates("attention micanism")
    assert got[0]["title"] == "Attention Is All You Need" and got[0]["landmark"] is True
    assert [p["title"] for p in got[1:]] == ["Paper 1", "Paper 2", "Paper 3"]  # the made-up title is dropped
