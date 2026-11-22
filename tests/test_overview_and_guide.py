"""The overview (short, enjoyable: key ideas, numbers, the figure to look at) and the in-depth guide (the full lesson,
read in its own reader)."""
import json

from papers import ai, figures, library, llm
from papers.ai import providers
from papers.chat import store


def make(client, **more):
    return client.post("/api/papers", json={"title": "Attention", "abstract": "transformers", **more}).json()


def overview(**more) -> llm.Skim:
    return llm.Skim(**{
        "tldr": "It replaces recurrence with attention.", "problem": "RNNs read one word at a time.",
        "key_idea": "Every word looks at every other word.",
        "picture": 'flowchart LR\n  A["Words"] --> B["Attention"]',
        "ideas": [{"title": "Soft lookup", "text": "Queries match keys."}],
        "numbers": [{"value": "28.4 BLEU", "what": "English to German"}],
        "figure": {"number": 2, "why": "It shows the attention steps."},
        "caveats": ["Quadratic in length."], "verdict": "Read it fully.", "relevance": "", **more})


def test_the_overview_knows_the_figures_and_asks_for_short_key_ideas(client, monkeypatch):
    p = make(client, text="Figure 2: Scaled dot-product attention.")
    monkeypatch.setattr(figures, "known", lambda pid: [{"kind": "figure", "number": 2, "page": 4, "caption": "Figure 2: Attention."}])
    asked = []
    monkeypatch.setattr(ai, "parse", lambda prompt, schema, **kw: asked.append(prompt) or overview())
    result = client.post(f"/api/papers/{p['id']}/skim").json()
    assert result["ideas"][0]["title"] == "Soft lookup" and result["figure"]["number"] == 2
    assert "Figure 2 (page 4)" in asked[0] and "never a list of everything" in asked[0]
    saved = client.get(f"/api/papers/{p['id']}").json()["skim"]
    assert saved["numbers"] == [{"value": "28.4 BLEU", "what": "English to German"}]


def test_the_notes_file_has_the_key_ideas(client):
    p = client.get(f"/api/papers/{make(client)['id']}").json()
    md = library.notes({**p, "skim": overview().model_dump()}, None, [], None, [])
    assert "**Key ideas**" in md and "**Soft lookup.** Queries match keys." in md and "**28.4 BLEU**" in md


def test_a_guide_is_asked_without_follow_ups_and_titled(client, monkeypatch):
    seen = []

    def stream(paper, turns, language="", figures=None):
        seen.append(turns)
        yield "## The problem\nRNNs are slow."
    monkeypatch.setattr(llm, "conversation_stream", stream)
    monkeypatch.setattr(providers, "backend", lambda: "codex")  # no tools: written the Quick way
    p = make(client)
    lines = [json.loads(x) for x in client.post(f"/api/papers/{p['id']}/conversations/start",
                                                json={"kind": "guide", "content": "Write the in-depth guide."}).text.splitlines()]
    done = lines[-1]["message"]
    assert lines[-1]["type"] == "done" and done["kind"] == "guide" and done["meta"]["followups"] == []
    prompt = llm._turn(seen[0][-1], "", True)
    assert "## The problem" in prompt and "```followups" not in prompt and "no title" in prompt
    assert client.get(f"/api/conversations/{lines[0]['conversation']['id']}").json()["title"] == "In-depth guide"
    guides = client.get(f"/api/papers/{p['id']}/guides").json()
    assert [g["id"] for g in guides] == [done["id"]] and guides[0]["words"] == 6
    assert client.get(f"/api/papers/{p['id']}/messages/{done['id']}").json()["content"].startswith("## The problem")


def test_a_guide_is_read_only_on_its_own_paper(client, monkeypatch):
    monkeypatch.setattr(llm, "conversation_stream", lambda paper, turns, language="", figures=None: iter(["Short answer."]))
    monkeypatch.setattr(providers, "backend", lambda: "codex")
    a, b = make(client), make(client)
    lines = [json.loads(x) for x in client.post(f"/api/papers/{a['id']}/conversations/start", json={"content": "Hi"}).text.splitlines()]
    answer_id, question_id = lines[-1]["message"]["id"], lines[1]["message"]["id"]
    assert client.get(f"/api/papers/{a['id']}/messages/{answer_id}").status_code == 200
    assert client.get(f"/api/papers/{b['id']}/messages/{answer_id}").status_code == 404  # another paper's answer
    assert client.get(f"/api/papers/{a['id']}/messages/{question_id}").status_code == 404  # a question, not an answer
    assert store.guides_for(a["id"]) == []  # an ordinary answer isn't a guide
