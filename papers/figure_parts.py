"""What's where in a figure, and what the figures and ideas of several papers have in common.

- `parts(paper, kind, number)`: the figure's main parts as boxes on its 10 x 10 grid ({label, from, to}). The Deep
  agent is asked to look at the figure and box them, the same way it does in an answer, so it works with every
  model that can use tools and see images. Found once per figure, then kept.
- `match(a, b)`: which parts of two figures are the same thing (the encoder here is the encoder there).
- `idea_map(papers)`: the ideas of a goal's papers and which builds on which, as a Mermaid flowchart.
"""
import json
import random
import re

from pydantic import BaseModel

from papers import ai, db, figures
from papers.ai import capabilities
from papers.chat.answer import FIGURE, tidy_boxes
from papers.store import get_paper

ASK_PARTS = ("Look at {name} with the look_at_figure tool, then point at its 3 to 6 main parts with numbered boxes, "
             "each named in 2 to 4 words (\"the encoder\", \"attention weights\"). Answer with only the ```figure block.")


class NoParts(Exception):
    """The parts of a figure couldn't be found (no model that can see and point, or it didn't)."""


def _key(paper_id: int, kind: str, number: int) -> str:
    return f"figure_parts:{paper_id}:{kind}-{number}"


def kept(paper_id: int, kind: str, number: int) -> list[dict] | None:
    raw = db.setting(_key(paper_id, kind, number))
    return json.loads(raw) if raw else None


def parts(paper_id: int, kind: str, number: int) -> list[dict]:
    """The figure's main parts as boxes, found by the agent the first time and kept."""
    if (known := kept(paper_id, kind, number)) is not None:
        return known
    if ai.backend() == "codex" or not capabilities.allows("tools") or not capabilities.allows("pointing"):
        raise NoParts("Finding a figure's parts needs a model that can see figures and use tools (Claude can).")
    from papers.agent import loop as agent
    from papers.agent import tools
    paper = get_paper(paper_id)
    name = f"{'Table' if kind == 'table' else 'Figure'} {number}"
    turns = [{"role": "user", "kind": "ask", "content": ASK_PARTS.format(name=name), "attachments": []}]
    text, steps = [], []
    for piece in agent.run(paper, turns, figures=figures.known(paper_id)):
        if isinstance(piece, agent.Step):
            if piece.state == "done":
                steps.append({"name": piece.name, "summary": piece.summary})
        elif isinstance(piece, str):
            text.append(piece)
    if (kind, number) not in tools.seen(steps):
        raise NoParts(f"The model didn't look at {name}, so it couldn't say where its parts are.")
    boxes = []
    for block in FIGURE.findall("".join(text)):
        try:
            spec = json.loads(block)
        except ValueError:
            continue
        if isinstance(spec, dict) and int(spec.get(kind) or 0) == number:
            boxes = tidy_boxes(spec.get("boxes"))
    found = [{"label": str(b.get("label") or "").strip()[:60], "from": b["from"], "to": b.get("to") or b["from"]}
             for b in boxes if str(b.get("label") or "").strip()]
    if len(found) < 2:
        raise NoParts(f"The model couldn't name enough parts of {name}.")
    db.set_setting(_key(paper_id, kind, number), json.dumps(found))
    return found


# ---------- The figure quiz (Recall) ----------
def quiz_choices() -> list[dict]:
    """Figures you could be quizzed on: from papers you're reading or have finished, figures (not tables), parts
    already found first (no waiting for the AI)."""
    with db.connect() as conn:
        rows = conn.execute("select id, title from papers where status in ('read', 'reading') and coalesce(archived, 0) = 0").fetchall()
    out = []
    for r in rows:
        for f in figures.known(r["id"]):
            if f["kind"] == "figure":
                out.append({"paper_id": r["id"], "title": r["title"], "number": f["number"], "caption": f["caption"],
                            "page": f["page"], "ready": kept(r["id"], "figure", f["number"]) is not None})
    return out


def pick_for_quiz(skip: str = "") -> dict | None:
    """One figure to be quizzed on, with its parts (found now if need be). `skip`: "paper:number" just shown."""
    choices = [c for c in quiz_choices() if f"{c['paper_id']}:{c['number']}" != skip]
    if not choices:
        return None
    ready = [c for c in choices if c["ready"]]
    random.shuffle(choices)
    for c in (random.sample(ready, len(ready)) if ready else []) + choices[:3]:  # a known one, or try a few
        try:
            return {**c, "parts": parts(c["paper_id"], "figure", c["number"]),
                    "url": f"/api/papers/{c['paper_id']}/figures/{figures.image_name('figure', c['number'])}"}
        except NoParts as e:
            failure = e
    raise failure


# ---------- Two figures side by side ----------
class Pair(BaseModel):
    a: int  # part number in the first figure
    b: int  # part number in the second
    same: str  # what they both are, in a few words


class Pairs(BaseModel):
    pairs: list[Pair]


def match(first: dict, second: dict) -> list[dict]:
    """Which parts of two figures play the same role. Each figure: {title, caption, parts}."""
    def listing(f: dict) -> str:
        rows = "\n".join(f"  {i}. {p['label']}" for i, p in enumerate(f["parts"], 1))
        return f"Paper: {f['title']}\nCaption: {f['caption']}\nParts:\n{rows}"
    prompt = ("Two figures from two research papers, each with its main parts numbered. Pair the parts that play the "
              "same role in both (the same component, step or quantity, even if named differently). Pair a part at "
              "most once; leave out parts with no counterpart. For each pair, say in a few words what they both are."
              f"\n\n<first>\n{listing(first)}\n</first>\n\n<second>\n{listing(second)}\n</second>")
    pairs, used_a, used_b = [], set(), set()
    for p in ai.parse(prompt, Pairs, effort="low").pairs:
        if 1 <= p.a <= len(first["parts"]) and 1 <= p.b <= len(second["parts"]) and p.a not in used_a and p.b not in used_b:
            used_a.add(p.a)
            used_b.add(p.b)
            pairs.append({"a": p.a - 1, "b": p.b - 1, "same": p.same.strip()[:60]})
    return pairs


# ---------- The ideas of a goal's papers ----------
class Idea(BaseModel):
    name: str  # 2 to 5 words
    papers: list[int]  # the numbers of the papers it comes from
    builds_on: list[int]  # the numbers of earlier ideas in this list it builds on


class IdeaMap(BaseModel):
    ideas: list[Idea]


def idea_map(goal: str, papers: list[dict]) -> dict:
    """The main ideas across the papers and which builds on which: {"diagram": Mermaid flowchart, "papers": [...]}."""
    listing = "\n\n".join(f"[{n}] {p['title']} ({p.get('year') or 'n.d.'})\n{(p.get('tldr') or p.get('key_idea') or p.get('abstract') or '')[:600]}"
                          for n, p in enumerate(papers, 1))
    prompt = ("These papers are read for one goal. Name the 5 to 12 main ideas they contain (methods, findings, "
              "concepts), each in 2 to 5 plain words, with the numbers of the papers it comes from, and the earlier "
              "ideas in your list that it builds on (by their position, starting at 1; only earlier ones). Order the "
              "ideas from the most basic to the most advanced. Merge ideas that are the same thing."
              f"\n\n<goal>{goal}</goal>\n\n<papers>\n{listing}\n</papers>")
    ideas = ai.parse(prompt, IdeaMap, effort="low").ideas[:14]
    clean = lambda s: re.sub(r'["\[\]{}()<>|#;`]', "", s).strip()[:48] or "idea"
    lines = ["flowchart LR"]
    for i, idea in enumerate(ideas, 1):
        refs = sorted({n for n in idea.papers if 1 <= n <= len(papers)})
        tag = f" · {', '.join(map(str, refs))}" if refs else ""
        lines.append(f'  I{i}["{clean(idea.name)}{tag}"]')
    for i, idea in enumerate(ideas, 1):
        for j in sorted({j for j in idea.builds_on if 1 <= j < i}):
            lines.append(f"  I{j} --> I{i}")
    return {"diagram": "\n".join(lines), "papers": [{"n": n, "id": p["id"], "title": p["title"]} for n, p in enumerate(papers, 1)],
            "ideas": len(ideas)}


def kept_map(topic_id: int) -> dict | None:
    raw = db.setting(f"idea_map:{topic_id}")
    return json.loads(raw) if raw else None


def make_map(topic_id: int, goal: str, papers: list[dict]) -> dict:
    found = idea_map(goal, papers)
    db.set_setting(f"idea_map:{topic_id}", json.dumps(found))
    return found
