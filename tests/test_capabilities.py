"""Finding out what the chosen model can do (images, tools), and pointing at figures only after seeing them."""
import io
import json

import httpx
import pytest

from papers import figures
from papers.agent import tools
from papers.ai import capabilities, openai_compat
from papers.chat.answer import only_seen_boxes


@pytest.fixture
def server(client, monkeypatch):
    """An OpenAI-compatible provider whose answers the test decides: handle(body) -> httpx.Response."""
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "custom", "ai_base_url": "http://m.test/v1", "ai_model": "m"})
    box = {}
    monkeypatch.setattr(openai_compat, "TRANSPORT", httpx.MockTransport(lambda r: box["handle"](json.loads(r.content))))
    return box


def says(message):
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", **message}}]})


def test_the_picture_is_a_real_png():
    from PIL import Image
    image = Image.open(io.BytesIO(capabilities.png((220, 30, 30))))
    assert image.size == (64, 64) and image.convert("RGB").getpixel((10, 50)) == (220, 30, 30)


@pytest.mark.llm_plumbing
def test_a_model_that_sees_and_calls_tools(client, server, monkeypatch):
    monkeypatch.setattr(capabilities.random, "choice", lambda items: ("green", capabilities.COLOURS["green"]))

    def handle(body):
        if "tools" in body:
            return says({"content": None, "tool_calls": [{"id": "1", "function": {"name": "add", "arguments": "{}"}}]})
        assert body["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
        return says({"content": "Green."})
    server["handle"] = handle
    assert client.get("/api/settings").json()["ai_can"] is None  # not checked yet
    found = client.post("/api/ai/capabilities").json()
    assert found["images"]["ok"] is True and found["tools"]["ok"] is True and found["ai_vision"] is True
    again = client.get("/api/settings").json()  # remembered, and "Look at figures" was turned on
    assert again["ai_can"]["images"]["ok"] is True and again["ai_vision"] is True
    client.put("/api/settings", json={"ai_model": "another"})
    assert client.get("/api/settings").json()["ai_can"] is None  # another model: not known


@pytest.mark.llm_plumbing
def test_a_model_that_does_neither(client, server):
    client.put("/api/settings", json={"ai_vision": True})

    def handle(body):
        if "tools" in body:
            return says({"content": "17 + 25 = 42"})  # answered without the tool
        return httpx.Response(400, json={"error": {"message": "image input is not supported"}})
    server["handle"] = handle
    found = client.post("/api/ai/capabilities").json()
    assert found["images"]["ok"] is False and found["tools"]["ok"] is False and found["ai_vision"] is False


@pytest.mark.llm_plumbing
def test_a_guess_or_a_server_that_is_down_proves_nothing(client, server, monkeypatch):
    monkeypatch.setattr(capabilities.random, "choice", lambda items: ("blue", capabilities.COLOURS["blue"]))
    server["handle"] = lambda body: says({"content": "It could be red, green, blue or yellow."})
    assert capabilities.sees_images()["ok"] is False
    client.put("/api/settings", json={"ai_vision": True})
    server["handle"] = lambda body: httpx.Response(503, json={"error": {"message": "overloaded"}})
    found = client.post("/api/ai/capabilities").json()
    assert found["images"]["ok"] is None and found["ai_vision"] is True  # couldn't tell: the switch stays as it was
    assert client.get("/api/settings").json()["ai_can"] is None


def test_claude_and_chatgpt_are_known_without_asking(client):
    client.put("/api/settings", json={"ai_provider": "claude-plan"})
    can = client.post("/api/ai/capabilities").json()
    assert can["images"]["ok"] and can["tools"]["ok"]
    client.put("/api/settings", json={"ai_provider": "chatgpt-plan"})
    assert client.get("/api/settings").json()["ai_can"]["tools"]["ok"] is False


# ---------- pointing at parts of a figure ----------
def test_the_grid_names_its_cells():
    from PIL import Image
    plain = io.BytesIO()
    Image.new("RGB", (300, 200), "white").save(plain, "PNG")
    gridded = Image.open(io.BytesIO(figures.with_grid(plain.getvalue())))
    assert gridded.width >= 700 and gridded.width / gridded.height == pytest.approx(1.5, rel=0.15)
    assert figures.with_grid(b"not an image") is None


def test_boxes_stay_only_on_figures_the_model_looked_at():
    steps = [{"name": "read_section", "summary": "Read §3"}, {"name": "look_at_figure", "summary": "Looked at Figure 2"},
             {"name": "look_at_figure", "summary": "Read about Figure 1 (the image isn't sent to this model)"}]
    assert tools.seen(steps) == {("figure", 2)}
    text = ('Look:\n```figure\n{"figure": 1, "boxes": [{"from": "A1", "to": "B2", "label": "guess"}]}\n```\nand\n'
            '```figure\n{"figure": 2, "boxes": [{"from": "C3", "to": "D4", "label": "seen"}]}\n```')
    kept = only_seen_boxes(text, tools.seen(steps))
    assert "guess" not in kept and '{"figure": 1}' in kept and "seen" in kept
    assert "boxes" not in only_seen_boxes(text, set())  # Quick mode never sees a figure
