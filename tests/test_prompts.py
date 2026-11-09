"""What the model is asked in a conversation: the tutor's rules, the job of each kind of message, the figures it may
show, and follow-up suggestions."""
from papers import ai, llm

PAPER = {"title": "Attention", "authors": "Vaswani", "abstract": "transformers", "text": "We propose the Transformer."}


def ask(monkeypatch, turns, figures=None, language=""):
    seen = {}
    monkeypatch.setattr(ai, "stream", lambda system, messages: seen.update(system=system, messages=messages) or iter(["ok"]))
    list(llm.conversation_stream(PAPER, turns, language=language, figures=figures))
    return seen


def test_explain_asks_for_a_deep_lesson_with_visuals_and_follow_ups(monkeypatch):
    seen = ask(monkeypatch, [{"role": "user", "kind": "explain", "content": "", "attachments": [{"text": "PE(pos,2i)", "label": "Page 6"}]}])
    last = seen["messages"][-1]["content"]
    assert '<passage from="Page 6">\nPE(pos,2i)\n</passage>' in last
    assert "The problem" in last and "worked example" in last and "Check yourself" in last
    assert "```followups" in last
    tutor = seen["system"][0]["text"]
    assert "```math" in tutor and "```chart" in tutor and "```diagram" in tutor and "```figure" in tutor
    assert seen["system"][1]["cache_control"] == {"type": "ephemeral"}  # the paper is cached, the task is not


def test_simplify_is_a_rewrite_not_a_lesson(monkeypatch):
    last = ask(monkeypatch, [{"role": "user", "kind": "simplify", "content": "", "attachments": [{"text": "x"}]}])["messages"][-1]["content"]
    assert "rewrite, not a lesson" in last and "no visuals" in last.lower()


def test_translate_names_the_language_and_skips_follow_ups(monkeypatch):
    last = ask(monkeypatch, [{"role": "user", "kind": "translate", "content": "", "attachments": [{"text": "x"}]}],
               language="French")["messages"][-1]["content"]
    assert "into French" in last and "followups" not in last


def test_only_the_message_being_answered_carries_the_task(monkeypatch):
    seen = ask(monkeypatch, [
        {"role": "user", "kind": "explain", "content": "", "attachments": [{"text": "x"}]},
        {"role": "assistant", "kind": "explain", "content": "An answer.", "attachments": []},
        {"role": "user", "kind": "ask", "content": "Why?", "attachments": []},
    ])
    first, answer, last = (m["content"] for m in seen["messages"])
    assert "The problem" not in first and "(Explain this.)" in first
    assert answer == "An answer."
    assert last.startswith("Why?") and "direct answer" in last


def test_the_papers_figures_are_listed_for_the_model(monkeypatch):
    seen = ask(monkeypatch, [{"role": "user", "kind": "ask", "content": "Q", "attachments": []}],
               figures=[{"kind": "figure", "number": 1, "page": 3, "caption": "Figure 1: The Transformer"}])
    assert "<figures>\nFigure 1 (page 3): Figure 1: The Transformer\n</figures>" in seen["system"][1]["text"]
