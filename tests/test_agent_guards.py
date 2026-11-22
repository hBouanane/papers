"""What keeps a weak model from spoiling an answer: boxes that point at something, tool calls written as text, the
checks that switch off what a model can't do, and saying when the paper was too long for it."""
import json

import httpx
import pytest

from papers import llm, roadmap
from papers.ai import capabilities, openai_compat, providers
from papers.chat import answer


def test_boxes_must_point_at_a_part():
    boxes = [{"from": "B5", "to": "E8", "label": "encoder"}, {"from": "A1", "to": "T20", "label": "everything"},
             {"from": "E8", "to": "B5", "label": "encoder again"}, {"from": "U21", "to": "L2", "label": "off the grid"},
             {"from": "F3", "to": "I8", "label": "decoder"}, *[{"from": f"{c}1", "to": f"{c}1"} for c in "ABCDEFGH"]]
    kept = answer.tidy_boxes(boxes)
    assert [b.get("label") for b in kept[:2]] == ["encoder", "decoder"] and len(kept) == answer.MOST_BOXES


def test_tool_calls_written_as_text_are_taken_out():
    text = 'Let me look.\n<tool_call>{"name": "look_at_figure", "arguments": {"number": 1}}</tool_call>\nFigure 1 shows the encoder.'
    assert answer.strip_tool_text(text) == ("Let me look.\n\nFigure 1 shows the encoder.", True)
    assert answer.strip_tool_text('```json\n{"name": "search_paper", "arguments": {"query": "loss"}}\n```')[0] == ""
    plain = 'A dict like {"name": "Ada"} is fine.'
    assert answer.strip_tool_text(plain) == (plain, False)


@pytest.fixture
def server(client, monkeypatch):
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "custom", "ai_base_url": "http://m.test/v1", "ai_model": "m"})
    box = {}
    monkeypatch.setattr(openai_compat, "TRANSPORT", httpx.MockTransport(lambda r: box["handle"](json.loads(r.content))))
    return box


def says(text):
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": text}}]})


@pytest.mark.llm_plumbing
def test_the_json_check(server, monkeypatch):
    monkeypatch.setattr(capabilities.random, "randint", lambda a, b: 20)
    server["handle"] = lambda body: says('```json\n{"sum": 40, "words": ["two", "short", "words"]}\n```')
    assert capabilities.writes_json()["ok"] is True
    server["handle"] = lambda body: says('{"sum": 40, "words": ["two", "short", "words"],}')  # a trailing comma
    assert capabilities.writes_json()["ok"] is False


@pytest.mark.llm_plumbing
def test_the_pointing_check(server, monkeypatch):
    picks = iter([2, 3, 2])  # the square's column, row and size: C4 to D5
    monkeypatch.setattr(capabilities.random, "randint", lambda a, b: next(picks))
    server["handle"] = lambda body: says("C4 to D5")
    assert capabilities.points_at()["ok"] is True
    picks = iter([2, 3, 2])
    server["handle"] = lambda body: says("A1 to T20")
    assert capabilities.points_at()["ok"] is False


def test_what_a_model_fails_is_switched_off(client, monkeypatch):
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "custom", "ai_model": "weak"})
    from papers import db
    db.set_setting(capabilities._key(), json.dumps({
        "images": {"ok": True}, "tools": {"ok": False}, "json": {"ok": False}, "pointing": {"ok": False}}))
    assert not capabilities.allows("tools") and not capabilities.allows("pointing")
    assert "don't write ```chart" in llm.tutor()  # plain visuals only
    asked = {"content": "What is in Figure 1?", "meta": {}}
    assert not answer.about_a_figure(asked, [{"kind": "figure", "number": 1}])  # no Deep mode without tools
    monkeypatch.setattr(providers, "backend", lambda: "api")  # Claude: known to do all of it
    assert capabilities.allows("pointing") and "don't write ```chart" not in llm.tutor()


def test_saying_when_the_paper_was_cut(client):
    long_paper = {"text": "x" * 30_000}
    assert not llm.shortened(long_paper)
    client.put("/api/settings", json={"ai_context": "8k"})
    assert llm.shortened(long_paper) and not llm.shortened({"text": "short"})


def test_reading_times_stay_believable(client, monkeypatch):
    from papers import scholar
    monkeypatch.setattr(llm, "search_queries", lambda goal: ["q"])
    monkeypatch.setattr(llm, "landmark_titles", lambda goal: [])
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: [{"external_id": "s2-1", "title": "P", "authors": "", "year": 2020,
                                                                 "abstract": "", "url": "", "pdf_url": "", "citations": 1}])
    monkeypatch.setattr(scholar, "foundations", lambda found, most=10: found)
    plan = roadmap.Plan(intro="", stages=[roadmap.Stage(title="S", why="", papers=[roadmap.Pick(number=1, reason="r", minutes=900)])])
    monkeypatch.setattr(roadmap, "plan_with_ai", lambda goal, found: plan)
    goal = client.post("/api/topics", json={"goal": "g"}).json()["id"]
    assert client.post(f"/api/topics/{goal}/roadmap").json()["stages"][0]["items"][0]["minutes"] == 240


def test_the_grid_is_a_chessboard():
    """Names only along the edges, so the squares can be small; cells read with the grid a box was made on."""
    import io

    from PIL import Image

    from papers import figures
    out = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(out, "PNG")
    sheet = Image.open(io.BytesIO(figures.with_grid(out.getvalue())))
    assert sheet.width > 1000  # enlarged so 20 columns stay apart, with room for the names on all four edges
    assert figures.cell("T20") == (19, 19) and figures.cell("U1") is None and figures.cell("J10", 10) == (9, 9)
    assert figures.cell("K12", 10) is None  # an old 10 x 10 answer has no K12


def test_a_passage_that_refers_to_a_figure_is_explained_with_it(monkeypatch):
    from papers.ai import providers
    monkeypatch.setattr(providers, "backend", lambda: "openai")
    known = [{"kind": "figure", "number": 2}]
    asked = {"content": "", "meta": {"attachments": [{"label": "§3.2", "text": "The encoder, as shown in Figure 2, stacks six layers."}]}}
    assert answer.about_a_figure(asked, known)  # Deep, so the answer can box the part of Figure 2 it explains
    plain = {"content": "", "meta": {"attachments": [{"label": "§3.2", "text": "The encoder stacks six layers."}]}}
    assert not answer.about_a_figure(plain, known)
