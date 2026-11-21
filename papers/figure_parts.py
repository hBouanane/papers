"""What's where in a figure, for the figure quiz in Recall.

`parts(paper, kind, number)`: the figure's main parts as boxes on its 10 x 10 grid ({label, from, to}). The Deep
agent is asked to look at the figure and box them, the same way it does in an answer, so it works with every model
that can use tools and see images. Found once per figure, then kept.
"""
import json
import random

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


