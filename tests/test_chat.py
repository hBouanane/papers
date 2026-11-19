

def test_a_question_about_a_figure_is_answered_in_deep_mode(monkeypatch):
    from papers.ai import providers
    from papers.chat import answer
    known = [{"kind": "figure", "number": 1}, {"kind": "table", "number": 2}]
    ask = lambda text, labels=(): {"content": text, "meta": {"attachments": [{"label": x} for x in labels]}}  # noqa: E731
    monkeypatch.setattr(providers, "backend", lambda: "openai")
    assert answer.about_a_figure(ask("Draw boxes on the encoder in Figure 1"), known)
    assert answer.about_a_figure(ask("what does this show?", ["Fig. 1"]), known)  # pointed at in the reader
    assert answer.about_a_figure(ask("Table 2: which is best?"), known)
    assert not answer.about_a_figure(ask("What is in Figure 7?"), known)  # not one of this paper's figures
    assert not answer.about_a_figure(ask("How does attention work?"), known)
    monkeypatch.setattr(providers, "backend", lambda: "codex")  # no tools: stays in Quick
    assert not answer.about_a_figure(ask("Figure 1"), known)
