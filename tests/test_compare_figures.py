"""Comparing a figure with one from another paper (Deep mode): figures only, the right paper, and nothing shown
unless the model really looked at both."""
import io
import json

import pytest

from papers import figures
from papers.agent import tools
from papers.chat.answer import checked_compares


def png() -> bytes:
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (120, 80), "white").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def two_papers(client, monkeypatch, tmp_path):
    a = client.post("/api/papers", json={"title": "Attention Is All You Need"}).json()["id"]
    b = client.post("/api/papers", json={"title": "Neural Machine Translation by Jointly Learning to Align and Translate"}).json()["id"]
    client.post("/api/papers", json={"title": "Attention in Vision"})
    client.post("/api/papers", json={"title": "Attention in Speech"})  # two papers match "attention": unclear
    listed = {a: [{"kind": "figure", "number": 1, "caption": "The Transformer.", "page": 3},
                  {"kind": "table", "number": 2, "caption": "Scores.", "page": 8}],
              b: [{"kind": "figure", "number": 1, "caption": "The RNN with attention.", "page": 3}]}
    monkeypatch.setattr(figures, "for_paper", lambda pid: listed.get(pid, []))
    monkeypatch.setattr(figures, "folder", lambda pid: tmp_path / str(pid))
    for pid in (a, b):
        (tmp_path / str(pid)).mkdir()
        (tmp_path / str(pid) / figures.image_name("figure", 1)).write_bytes(png())
    return a, b


def test_figures_side_by_side(client, two_papers):
    a, b = two_papers
    r = tools.run("compare_with_figure", a, {"own_figure": 1, "other_paper": "neural machine translation jointly align", "other_figure": 1})
    assert r.image and "```compare" in r.text and f'"paper": {b}' in r.text
    assert r.summary == "Compared Figure 1 with Figure 1 of “Neural Machine Translation by Jointly Learning to Align and Translate”"


def test_tables_and_unclear_papers_are_refused(client, two_papers):
    a, _ = two_papers
    table = tools.run("compare_with_figure", a, {"own_figure": 2, "other_paper": "Neural Machine Translation", "other_figure": 1})
    assert "figures only, not tables" in table.text and not table.image
    unclear = tools.run("compare_with_figure", a, {"own_figure": 1, "other_paper": "attention", "other_figure": 1})
    assert "No single paper" in unclear.text and not unclear.image


def compare_block(paper_id, pairs, left_boxes=None):
    spec = {"left": {"figure": 1, "boxes": left_boxes or [{"from": "B2", "to": "D5", "label": "encoder"}, {"from": "F2", "to": "H5", "label": "decoder"}]},
            "right": {"paper": paper_id, "figure": 1, "boxes": [{"from": "A2", "to": "C4", "label": "RNN"}, {"from": "E6", "to": "G8", "label": "output"}]},
            "pairs": pairs}
    return "Here.\n```compare\n" + json.dumps(spec) + "\n```"


def test_a_comparison_needs_the_tool(client, two_papers):
    _, b = two_papers
    text = compare_block(b, [{"left": 1, "right": 1, "same": "reads the input"}])
    assert checked_compares(text, set()).strip() == "Here."  # never compared in this answer: dropped
    seen = {(1, 1, "Neural Machine Translation by Jointly Learning to Align and Translate")}
    kept = json.loads(checked_compares(text, seen).split("```compare\n")[1].split("```")[0])
    assert kept["pairs"] == [{"left": 1, "right": 1, "same": "reads the input"}]


def test_pairs_follow_the_boxes_that_survive(client, two_papers):
    _, b = two_papers
    seen = {(1, 1, "Neural Machine Translation by Jointly Learning to Align and Translate")}
    boxes = [{"from": "A1", "to": "J10", "label": "everything"}, {"from": "F2", "to": "H5", "label": "decoder"}]
    pairs = [{"left": 1, "right": 1, "same": "whole"}, {"left": 2, "right": 2, "same": "writes the output"},
             {"left": 2, "right": 1, "same": "twice"}, {"left": 9, "right": 1, "same": "no such box"}]
    kept = json.loads(checked_compares(compare_block(b, pairs, boxes), seen).split("```compare\n")[1].split("```")[0])
    assert [x["label"] for x in kept["left"]["boxes"]] == ["decoder"]  # the box around everything goes
    assert kept["pairs"] == [{"left": 1, "right": 2, "same": "writes the output"}]  # renumbered, each box once
