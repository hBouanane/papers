"""The figure quiz, two figures side by side, and a goal's idea map: parts found once and kept, matches checked."""
import pytest

from papers import ai, figure_parts, figures
from papers.agent import loop as agent

ANSWER = ('```figure\n{"figure": 1, "boxes": [{"from": "B5", "to": "E8", "label": "the encoder"}, '
          '{"from": "F3", "to": "I8", "label": "the decoder"}, {"from": "A1", "to": "J10", "label": "everything"}]}\n```')


@pytest.fixture
def paper(client, monkeypatch):
    pid = client.post("/api/papers", json={"title": "Attention", "text": "Figure 1: The model."}).json()["id"]
    monkeypatch.setattr(figures, "known", lambda paper_id: [{"kind": "figure", "number": 1, "caption": "Figure 1: The model.", "page": 3}])
    monkeypatch.setattr(figures, "for_paper", lambda paper_id: figures.known(paper_id))
    monkeypatch.setattr(ai, "backend", lambda: "api")  # Claude: sees figures, uses tools
    return pid


def agent_that(looks: bool, text: str = ANSWER, calls: list | None = None):
    def run(paper, turns, language="", figures=None):
        if calls is not None:
            calls.append(turns[-1]["content"])
        if looks:
            yield agent.Step("1", "look_at_figure", "Looking at a figure", "done", "Looked at Figure 1")
        yield text
    return run


def test_parts_are_found_once_and_kept(client, paper, monkeypatch):
    calls = []
    monkeypatch.setattr(agent, "run", agent_that(True, calls=calls))
    first = client.get(f"/api/papers/{paper}/figures/figure-1/parts").json()["parts"]
    assert [p["label"] for p in first] == ["the encoder", "the decoder"]  # "everything" isn't a part
    assert client.get(f"/api/papers/{paper}/figures/figure-1/parts").json()["parts"] == first
    assert len(calls) == 1 and "Figure 1" in calls[0]


def test_no_parts_without_looking(client, paper, monkeypatch):
    monkeypatch.setattr(agent, "run", agent_that(False))
    r = client.get(f"/api/papers/{paper}/figures/figure-1/parts")
    assert r.status_code == 409 and "didn't look" in r.json()["detail"]


def test_the_quiz_picks_a_figure_from_what_you_read(client, paper, monkeypatch):
    monkeypatch.setattr(agent, "run", agent_that(True))
    assert client.get("/api/figure-quiz").status_code == 404  # not started reading yet
    client.put(f"/api/papers/{paper}/progress", json={"position": 0.1, "slices": [0]})  # started reading
    quiz = client.get("/api/figure-quiz").json()
    assert quiz["number"] == 1 and len(quiz["parts"]) == 2 and quiz["url"].endswith("/figures/figure-1.png")


def test_matched_parts_are_checked(client, paper, monkeypatch):
    monkeypatch.setattr(agent, "run", agent_that(True))
    other = client.post("/api/papers", json={"title": "RNN attention", "text": "Figure 1: Another model."}).json()["id"]
    answer = figure_parts.Pairs(pairs=[figure_parts.Pair(a=1, b=1, same="encoder"), figure_parts.Pair(a=1, b=2, same="again"),
                                       figure_parts.Pair(a=9, b=1, same="no such part")])
    monkeypatch.setattr(ai, "parse", lambda prompt, schema, **kw: answer)
    r = client.post("/api/figures/compare", json={"first": {"paper_id": paper, "number": 1}, "second": {"paper_id": other, "number": 1}}).json()
    assert r["pairs"] == [{"a": 0, "b": 0, "same": "encoder"}]  # each part paired once, only real parts
    assert len(r["sides"]) == 2 and r["sides"][1]["title"] == "RNN attention"


def test_the_idea_map_is_a_diagram_with_only_earlier_links(client, monkeypatch):
    goal = client.post("/api/topics", json={"goal": "attention"}).json()["id"]
    assert client.post(f"/api/topics/{goal}/idea-map").status_code == 400  # needs two papers
    for title in ("RNN attention", "Transformer"):
        client.post("/api/papers", json={"title": title, "topic_id": goal})
    ideas = figure_parts.IdeaMap(ideas=[
        figure_parts.Idea(name="Encoder-decoder", papers=[1], builds_on=[]),
        figure_parts.Idea(name='Attention "weights" [new]', papers=[1, 2, 7], builds_on=[1, 2, 5])])
    monkeypatch.setattr(ai, "parse", lambda prompt, schema, **kw: ideas)
    made = client.post(f"/api/topics/{goal}/idea-map").json()
    assert made["diagram"].splitlines() == ["flowchart LR", '  I1["Encoder-decoder · 1"]', '  I2["Attention weights new · 1, 2"]', "  I1 --> I2"]
    assert client.get(f"/api/topics/{goal}/idea-map").json() == made  # kept for the goal page
