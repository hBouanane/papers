"""What the app asks AI models: one function per task (skim a paper, explain a passage, write a quiz, ...).

Each builds a prompt and, for answers with a fixed shape, a pydantic model for it; `ai.parse` sends it to the
model chosen in Settings (see papers/ai/). To change what the AI writes, change the prompt here.
Tests replace these functions with fakes, so nothing here runs during tests unless a test asks for it.
"""
from typing import Literal

from pydantic import BaseModel

from papers import ai
from papers.ai import AIError  # noqa: F401  (callers catch llm.AIError)
from papers.ai.streaming import Thinking


class Queries(BaseModel):
    queries: list[str]


def search_queries(goal: str) -> list[str]:
    prompt = (
        "A researcher describes what they need to work on. Write 3 short keyword queries "
        f"for an academic paper search engine that together cover it.\n\n<goal>{goal}</goal>"
    )
    return ai.parse(prompt, Queries, effort="low").queries


class Landmarks(BaseModel):
    titles: list[str]


def landmark_titles(goal: str) -> list[str]:
    """The papers anyone starting on this goal reads first, by exact title. A keyword search often misses them
    ("attention mechanism" doesn't find "Attention Is All You Need"), so they're looked up by name. Each title is
    checked against the paper databases afterwards, so one that doesn't exist is simply dropped."""
    prompt = (
        "A researcher describes what they want to understand. Name the papers a newcomer must read first: the "
        "classic paper or papers that started the topic, and one good survey or tutorial if you know one. Give "
        "each paper's exact published title and nothing else. At most 6, fewer is fine, and only papers you are "
        f"sure exist. The goal may contain spelling mistakes; read past them.\n\n<goal>{goal}</goal>"
    )
    return [t.strip() for t in ai.parse(prompt, Landmarks, effort="low").titles if t.strip()][:6]


# Small (often local) models can't take a whole paper; Settings can cap how much of it is sent.
CONTEXT_CHARS = {"32k": 100_000, "8k": 24_000}


def shortened(paper: dict) -> bool:
    """Whether the model got only the beginning of this paper (Settings › How much of a paper to send)."""
    limit = CONTEXT_CHARS.get(ai.setting("ai_context"))
    return bool(limit and len(paper.get("text") or "") > limit)


def _paper_context(paper: dict) -> str:
    body = paper.get("text") or f"(Full text unavailable. Abstract only.)\n{paper.get('abstract', '')}"
    limit = CONTEXT_CHARS.get(ai.setting("ai_context"))
    if limit and len(body) > limit:
        body = body[:limit] + "\n\n[The rest of the paper was shortened to fit the model.]"
    return (
        f"<paper>\n<title>{paper['title']}</title>\n<authors>{paper.get('authors', '')}</authors>\n"
        f"<abstract>{paper.get('abstract', '')}</abstract>\n<full_text>\n{body}\n</full_text>\n</paper>"
    )


class Metadata(BaseModel):
    title: str
    authors: str
    year: int | None


def paper_metadata(head: str) -> dict:
    prompt = (
        f"<first_page>\n{head}\n</first_page>\n\n"
        "This is the start of a research paper's extracted text. Give its exact title, its authors as a "
        "comma-separated list of full names, and its publication year if stated (else null)."
    )
    return ai.parse(prompt, Metadata, effort="low").model_dump()


class Reference(BaseModel):
    title: str
    authors: str
    year: int | None


class References(BaseModel):
    references: list[Reference]


def extract_references(section: str) -> list[dict]:
    prompt = (
        f"<references_section>\n{section}\n</references_section>\n\n"
        "This is the reference list of a research paper, extracted from its PDF. List every cited work "
        "with its exact title, its authors as a comma-separated list, and its year (null if missing)."
    )
    return [r.model_dump() for r in ai.parse(prompt, References, effort="low").references]


class KeyIdea(BaseModel):
    title: str  # 2 to 5 words
    text: str  # one or two sentences


class KeyNumber(BaseModel):
    value: str  # "85%", "1.3B vs 175B"
    what: str  # what it means, in a short sentence


class KeyFigure(BaseModel):
    number: int  # 0 when no figure helps
    why: str


class Skim(BaseModel):
    """The overview: what a reader sees before reading. Short and enjoyable, not a summary of every section; the
    in-depth guide (TASKS["guide"]) is where the full lesson goes."""
    tldr: str
    problem: str
    key_idea: str
    picture: str  # Mermaid flowchart of how it works
    ideas: list[KeyIdea]
    numbers: list[KeyNumber]
    figure: KeyFigure
    caveats: list[str]
    verdict: str
    relevance: str


class Word(BaseModel):
    term: str
    kind: Literal["technical", "english"]
    meaning: str
    example: str
    translation: str  # in the reader's language; empty when none is set


class Glossary(BaseModel):
    words: list[Word]


def _translation_rule(language: str) -> str:
    return (f" Also give each one's translation into {language} (a word or short phrase)." if language
            else " Leave translation empty.")


def glossary(paper: dict, language: str = "") -> list[dict]:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "The reader is a researcher whose first language is not English. List the 25 to 40 words and "
        "phrases in this paper most likely to stop them, in the order they first appear. Include both: "
        "technical terms and acronyms (kind 'technical'), and general or academic English words, idioms and "
        "phrasal verbs a non-native speaker may not know, such as 'albeit', 'hence', 'on par with', 'ablation', "
        "'notwithstanding' (kind 'english'). Skip words any intermediate English speaker knows. For each, give "
        "the meaning in simple English (short sentences, everyday words), as it is used in this paper, and a "
        "short quote from the paper where it appears." + _translation_rule(language)
    )
    return [w.model_dump() for w in ai.parse(prompt, Glossary).words]


def define(paper: dict, term: str, context: str, language: str = "") -> dict:
    """One word or phrase the reader picked, explained as this paper uses it."""
    prompt = (
        f"{_paper_context(paper)}\n\n<term>{term}</term>\n<sentence>{context}</sentence>\n\n"
        "The reader's first language is not English. Explain this word or phrase as it is used here, in simple "
        "English (short sentences, everyday words). Say whether it is a technical term or general English, and "
        "quote the sentence it appears in." + _translation_rule(language)
    )
    return ai.parse(prompt, Word, effort="low").model_dump()


def skim(paper: dict, goal: str = "") -> dict:
    """The overview a reader sees before reading: a great teacher's two-minute introduction, short and enjoyable.
    Written for a reader whose first language may not be English, and shaped by what they are working on."""
    from papers import figures
    prompt = (
        f"{_paper_context(paper)}\n\n{_figures_list(figures.known(paper['id']))}\n\n"
        + (f"<my_goal>{goal}</my_goal>\n\n" if goal else "")
        + "Write the overview I see before reading this paper: what a great teacher says in the first two minutes, so I "
        "get the point, see why it matters and want to read on. Short and enjoyable, never a list of everything. I may "
        "not be a native English speaker: plain, simple English, short sentences, everyday words; a technical term only "
        "when needed, and then say what it means.\n\n"
        "Fill in:\n"
        "- tldr: two sentences: what the paper does and why it matters, for a newcomer.\n"
        "- problem: two or three sentences on the problem, with one concrete everyday example that makes it felt "
        "(for a training method: what a model did wrong before it).\n"
        "- key_idea: the one idea that makes it work, in one sentence.\n"
        "- picture: how it works, as Mermaid flowchart code: 'flowchart LR', then 3 to 6 steps or parts, each label 2 "
        "to 5 words in double quotes, joined by arrows; no styling, no subgraphs.\n"
        "- ideas: the 3 to 5 key ideas to leave with, each a short title and one or two sentences of intuition, no "
        "equations.\n"
        "- numbers: up to 4 headline results from the paper, each a short value (\"85%\", \"1.3B vs 175B\") and what "
        "it means in one short sentence; only numbers the paper reports; none if it has no results.\n"
        "- figure: the one figure in <figures> a newcomer should look at first: the one that shows the big picture "
        "(the whole method, set-up or result at a glance), not a detail that needs background they don't have yet; "
        "number 0 if every figure needs that background. In why, tell them how to read it: where to start, what the "
        "main parts are and what to notice, in two short sentences of plain words.\n"
        "- caveats: one to three short things to keep in mind (limits the authors admit, or obvious ones).\n"
        "- relevance: " + ("how this paper helps with my goal, concretely; say so plainly if it doesn't."
                           if goal else "leave empty.") + "\n"
        "- verdict: one line: read it fully, skim it, or skip it, and why."
    )
    return ai.parse(prompt, Skim).model_dump()


MODES = {
    "explain": "",
    "simplify": ("Rewrite this passage in simple, plain English for a reader whose first language is not English: "
                 "short sentences, common words, the same meaning. Then list up to 5 hard words from it, each with a "
                 "short, simple meaning."),
    "translate": ("Translate this passage into {language}, naturally and faithfully. Keep each technical term in "
                  "English in parentheses after its translation. Then add one or two sentences in {language} on what "
                  "it means in this paper."),
}


def explain(paper: dict, passage: str, question: str = "", mode: str = "explain", language: str = "") -> str:
    return "".join(p for p in explain_stream(paper, passage, question, mode=mode, language=language) if not isinstance(p, Thinking))


def explain_stream(paper: dict, passage: str, question: str = "", mode: str = "explain", language: str = ""):
    """The explanation as it is written (an iterator of text pieces)."""
    system = [
        {"type": "text", "text": (
            "You help a researcher understand a paper they are reading. You have the full paper. "
            "When they paste a passage, reformulate it in simpler terms, define jargon, connect it "
            "to the rest of the paper (earlier definitions, the method, the results), and give an "
            "intuition or small example when it helps. When they ask about the paper as a whole, "
            "answer from the paper and say where in it the answer comes from. Keep it short and plain.")},
        {"type": "text", "text": _paper_context(paper), "cache_control": {"type": "ephemeral"}},
    ]
    content = f"<passage>\n{passage}\n</passage>" if passage else ""
    if question:
        content += f"\n\nMy question: {question}" if passage else question
    if MODES.get(mode):  # after the cached paper, so every mode reuses the same cache
        content += "\n\n" + MODES[mode].format(language=language)
    return ai.stream(system, content)


# ---------- Conversations (papers/chat) ----------
# The tutor: what every conversation's answers follow. Explain, Simplify and Translate add their own job (TASKS).
TUTOR = r"""You are a patient expert tutor helping a researcher read a scientific paper. You have the whole paper below.

Be correct above all. Say what the paper says; when you go beyond it (background, later work), say so plainly.
The reader may not be a native English speaker: write clear, simple English. Short sentences, common words, and
define each technical term the first time you use it.

Format: Markdown. Short "##" headings only when an answer has several parts. Math in LaTeX: $...$ inline and $$...$$ on
its own line. The paper's text was copied out of a PDF, so its formulas can be garbled (lost superscripts, like
"100002i/dmodel"): always write them correctly, silently. Never mention the copy, the extraction or the PDF's text. Cite the paper wherever it helps the reader check you: [§3.4] for a
section, [Fig. 1], [Table 2], [Eq. 3], [p. 5], one per bracket. Only cite things that exist in the paper.

Visuals: when a picture explains better than words, add one or two visuals as fenced blocks (never more than three,
never just for decoration):
- A formula whose parts need explaining (the most useful one; use it for every important formula):
```math
{"tex": "\\htmlClass{t1}{\\bar{x}} = \\frac{1}{\\htmlClass{t2}{n}} \\sum_{j=1}^{\\htmlClass{t2}{n}} \\htmlClass{t3}{x_j}",
 "terms": [{"class": "t1", "symbol": "\\bar{x}", "meaning": "the average"},
           {"class": "t2", "symbol": "n", "meaning": "how many values there are"},
           {"class": "t3", "symbol": "x_j", "meaning": "the j-th value"}],
 "example": "For 2, 4 and 9: (2 + 4 + 9) / 3 = 5"}
```
  Wrap each part in \htmlClass{t1}{...} to \htmlClass{t6}{...} so it gets the same colour as its meaning. This is JSON:
  double every backslash, and nothing after the closing brace. (The example only shows the format: write the paper's
  own formula.)
- Numbers to compare (results from a table, a trend, a distribution): when the reader asks to plot or compare a
  table, take its numbers from the paper's text (tables are in it) and never invent one. Any Vega-Lite v5 spec (bars, lines, points,
  areas, heatmaps, box plots, error bars, layers, facets, transforms) with its data inline (no "url") and readable
  axis titles:
```chart
{"title": "Accuracy by model", "mark": "bar", "data": {"values": [{"model": "A", "acc": 71.2}, {"model": "B", "acc": 74.9}]},
 "encoding": {"x": {"field": "model", "type": "nominal", "title": "Model"}, "y": {"field": "acc", "type": "quantitative", "title": "Accuracy (%)"}}}
```
- How parts connect or follow each other: any Mermaid diagram. Pick the type that fits: flowchart (a method, a
  pipeline, an architecture, a pathway), sequenceDiagram (who sends what to whom: a protocol, a signalling cascade),
  stateDiagram-v2 (states and what moves between them), timeline (history, the phases of a study), mindmap (how
  ideas group), classDiagram or erDiagram (kinds of things and their relations), quadrantChart, gantt, sankey-beta
  (flows of amounts). Keep labels short (a few words), quote labels that have symbols, and keep it small enough to
  read at a glance (about 12 boxes at most). To compare two things, give each its own subgraph and draw no arrow
  between them: they're shown side by side. Bar charts should start their axis at zero.
```diagram
flowchart LR
  A["Sample"] --> B["Treatment"] --> D["Measure"]
  A --> C["Control"] --> D
```
- The paper's own figure or table, when the reader should look at it (you can't see the image yourself unless a
  tool shows it to you, so say what its caption and the text say about it, and never guess where things are in it):
```figure
{"figure": 1}
```
- Something the reader should play with to understand it: an interactive widget, in a ```widget block. Pick the
  kind that fits the idea and the paper's field, whatever the field (physics, biology, medicine, chemistry,
  economics, statistics, engineering, computer science, social science). Every expression is math.js (+ - * / ^,
  sin, cos, exp, log, sqrt, abs, min, max, floor, mod, pi, e, a ? b : c) over the sliders' names. All kinds take:
  "title"; "caption"; "params" (sliders: {"name", "from", "to", "step", "value", "label", "unit"}, and "play": true
  on one of them to add a play button that animates it); "let" (named values worked out from the sliders, usable
  in every expression: {"half": "log(2) / k"}); "outputs" (live numbers under the picture: [{"label", "expr",
  "unit", "digits"}]). Labels and text may hold {expressions} in braces. The kinds:
  "plot": curves, with moving points, shaded areas and marker lines. Lines are {"expr" in x, "label", "dash"} (or
  {"x", "y"} in t with "t": {"from", "to"}); "points" [{"x", "y", "label"}]; "areas" [{"expr", "from", "to"}]
  (shaded between the curve and zero); "vlines" / "hlines" [{"at", "label"}]; "y": {"from", "to", "label"} fixes
  the range.
```widget
{"type": "plot", "title": "How much drug is left in the blood", "x": {"from": 0, "to": 24, "label": "hours after the dose"},
 "y": {"from": 0, "to": 100, "label": "% of the dose"},
 "params": [{"name": "h", "from": 1, "to": 12, "step": 0.5, "value": 4, "label": "half-life", "unit": "h"},
            {"name": "t", "from": 0, "to": 24, "step": 0.5, "value": 8, "label": "time", "unit": "h", "play": true}],
 "lines": [{"expr": "100 * 0.5^(x / h)", "label": "drug left"}],
 "areas": [{"expr": "100 * 0.5^(x / h)", "from": 0, "to": "t"}],
 "points": [{"x": "t", "y": "100 * 0.5^(t / h)", "label": "{100 * 0.5^(t / h)} %"}],
 "vlines": [{"at": "h", "label": "one half-life"}],
 "outputs": [{"label": "Left after {t} h", "expr": "100 * 0.5^(t / h)", "unit": "%", "digits": 1}]}
```
  "scene": a free drawing that moves with the sliders: a set-up, a mechanism, a geometry, a small model. You
  choose the coordinates ("x" and "y": {"from", "to"}; "axes": true to show them). "shapes" are drawn in order:
  circle {x, y, r}, point {x, y}, rect {x, y, w, h} (x, y is its lower-left corner), line and arrow {x1, y1, x2,
  y2}, text {x, y, text}, curve {expr in x, from, to} or {x, y in t, "t": {"from", "to"}}, polygon {"points":
  [[x, y], ...]}. Every number may be an expression. Each takes "color" (blue, orange, green, red, purple, cyan,
  muted), "fill": true, "dash": true, "width", "label", "opacity", and "repeat": {"name": "k", "from": 0, "to": 5}
  to draw it once per value of k.
```widget
{"type": "scene", "title": "A pendulum", "x": {"from": -1.2, "to": 1.2}, "y": {"from": -1.4, "to": 0.2},
 "params": [{"name": "L", "from": 0.3, "to": 1.2, "step": 0.05, "value": 1, "label": "length", "unit": "m"},
            {"name": "t", "from": 0, "to": 10, "step": 0.02, "value": 0, "label": "time", "unit": "s", "play": true, "seconds": 10}],
 "let": {"a": "0.5 * cos(sqrt(9.81 / L) * t)"},
 "shapes": [{"shape": "line", "x1": -0.4, "y1": 0, "x2": 0.4, "y2": 0, "color": "muted", "width": 4},
            {"shape": "line", "x1": 0, "y1": 0, "x2": "L * sin(a)", "y2": "-L * cos(a)", "color": "muted"},
            {"shape": "circle", "x": "L * sin(a)", "y": "-L * cos(a)", "r": 0.08, "fill": "solid"}],
 "outputs": [{"label": "Period", "expr": "2 * pi * sqrt(L / 9.81)", "unit": "s", "digits": 2}]}
```
  "bars": bars that change with the sliders: {"bars": [{"label", "expr"}]}, or one bar per value of a counter:
  {"repeat": {"name": "k", "from": 0, "to": 10}, "expr": "combinations(10, k) * p^k * (1 - p)^(10 - k)",
  "x": {"label": "successes"}, "y": {"from": 0, "to": 0.5}, "params": [{"name": "p", ...}]}.
  "circles": dials: {"circles": [{"label", "angle" in radians}], "show": "sincos" | "degrees" | "turns" | "none"}.
  "heatmap": a grid of values: {"rows": {"name": "i", "from": 0, "to": 50, "label"}, "cols": {"name": "j", "from":
  0, "to": 31, "label"}, "expr": "..."}.
  "steps": a walkthrough, one step at a time: {"steps": [{"title": "...", "text": "Markdown"}]}.
  The examples only show the format: build the widget for this paper's own idea, with its real quantities and
  units. One widget per answer is usually enough; a second only when it shows a different idea.
  Never leave a visual unexplained: say before it how to read it (axes, colours, boxes), and for a widget what each
  slider changes and what to try and look for; its "caption" says this too in a sentence or two.
Only cite or show figures and tables listed in <figures> below. Write visual blocks directly in the Markdown, never
inside HTML tags.

This is a conversation: build on what you already said; don't repeat it."""

PAGES = r"""Interactive pages: when no widget fits and the idea truly needs a custom interactive demonstration, you may write
one small self-contained page as a ```page block: HTML with inline <style> and <script> (vanilla JavaScript, or
libraries only from https://cdn.jsdelivr.net). It runs in a sealed frame with no network: no fetch, no forms, no
external images. Keep it under 150 lines, readable on a narrow panel, and use the CSS variables --ink, --text,
--muted, --line and --bg for colours. Prefer a widget whenever one fits."""


def tutor() -> str:
    """The tutor's rules, with interactive pages when the reader turned them on in Settings."""
    from papers.ai import capabilities
    plain = "" if capabilities.allows("json") else (
        "\n\nThis model's JSON is unreliable: don't write ```chart, ```math or ```widget blocks. Use Markdown tables, "
        "formulas in $...$ and ```diagram blocks instead.")
    return TUTOR + plain + ("\n\n" + PAGES if ai.setting("ai_pages") == "on" else "")

TASKS = {
    "explain": """Explain this passage the way a patient expert teacher would, as deeply as it needs: a short, simple
passage needs a short answer; a formula or a key idea needs the full lesson. Use these headings, exactly as written,
in this order, leaving out the ones that don't apply (never number them, never add words to them):
## The problem
Why this part of the paper exists, and what goes wrong without it.
## The idea
The idea in plain words. An analogy only if it truly helps.
## The formula
Each important formula once, as a ```math visual whose "tex" colours each part with \\htmlClass (classes t1 to
t6, as in the example above) and whose "terms" explain those parts (don't also repeat the formula as $$...$$ or list its symbols
in text: the visual is the only place the formula appears). Then say in words what it computes.
## A worked example
Small, real numbers, worked out (a small table is good; a ```chart when a curve or a comparison shows it better).
## Why it works
When the paper claims something, show why it's true, step by step: derive it if it's math (for example with the
identity that makes it work), don't just restate it.
## In the paper
How it connects to the rest of the paper, with a citation for each point.
## Since then
Only if you are sure: what later work did with it. Say clearly that this is outside the paper.
End with "**Check yourself:**" and one short question about the most important point.
Don't label visuals ("Visual:", "Chart:"); put them where they help.""",
    "simplify": """Rewrite this passage in plain English for a reader whose first language is not English: short
sentences, common words, exactly the same meaning. Leave nothing out: every claim, number, name and formula stays
(formulas in LaTeX, written correctly, each followed by a few words saying what it computes). This is a rewrite, not a
lesson: add no explanations, examples, background or headings, and no visuals. Then a short list "**Hard words:**" with up to 5 words from the passage, each with a simple meaning.""",
    "translate": """Translate this passage into {language}, naturally and faithfully. Keep each technical term in
English in parentheses after its translation, and formulas as they are (in LaTeX). Then add one or two sentences in
{language} on what it means in this paper. No visuals.""",
    "ask": """Answer the question. Start with the direct answer in one or two sentences, then explain as much as the
question needs, using the paper.""",
    "guide": """Write the in-depth guide to this paper: the complete lesson that makes it understood.

WHO IT'S FOR. Someone reading this paper for the first time, who may not know its central concepts yet. They are
smart but new to this idea; they're not revisiting something they already know. The goal: when they finish, they can
explain the paper's method, its equations, its design decisions and its results to someone else, and feel confident
about it. A shallow summary fails them. So does a lesson that only makes sense to someone who already knows the topic.

HOW TO TEACH (this matters more than anything else):
- Teach from first principles. Never use a concept before you've taught it. When the paper builds on an idea (for
  example a model it improves, a lab technique, a statistical test, a physical law), teach that idea from scratch:
  what it is, why it exists, how it works, a tiny example, and its weakness that this paper addresses.
- Intuition first, then the formal version. For every important concept: the intuition in plain words, then the
  mathematics, then a worked example with small, real numbers, then why it's designed that way.
- Never introduce an equation without saying first what it represents. Show it as a ```math visual whose terms define
  every symbol, then walk through it step by step in words, then compute it once with small numbers.
- Write in complete, connected paragraphs that flow like a good teacher talking: each step leads to the next, with
  transitions ("So far... Now..."). No telegraphic notes, no lists of fragments, no jumping between ideas mid-thought,
  no summarising where explaining is needed. Lists are fine for genuinely separate items.
- Be technically rigorous without being complicated. Use natural, direct, simple English; short sentences; define
  every hard word the first time it appears. Don't skip a technical detail to simplify: explain it instead.
- Be concrete: the paper's real quantities, units and settings; everyday analogies only where they truly help.
- It must work for any field (biology, medicine, physics, chemistry, economics, social science, engineering, computer
  science...): teach whatever this paper's own foundations are.

VISUALS. Use them wherever they teach, about one per section: ```math for formulas, ```diagram for how parts connect
or the order of steps, ```chart for numbers, ```figure for the paper's own figures (look at a figure first, then box
exactly the part you explain), ```widget when playing with a value teaches something. Every visual must be fully
explained, because the reader sees it for the first time:
- Before it: what it shows and how to read it (what each axis, colour, box, row or column means).
- For a widget, after it: what each slider or button changes, and exactly what to try and what they'll see ("Drag
  the base from 10,000 down to 100: the right-hand columns start to change from row to row, because..."). Give
  its "caption" the same reading guide in one or two sentences.
- After it: what to take away from it.
A visual the reader can't read without help teaches nothing.

STRUCTURE. Use "##" sections in this order (adapt the depth to the paper; leave one out only when it truly doesn't
apply; never number them). Start directly with the first heading: no title, no introduction, and don't narrate what
you're about to do.
## The paper in brief
What the paper is (who, when, the field), the problem it tackles and what it achieved, in a short paragraph, so the
reader knows where the lesson is going.
## What you need to know first
The concepts the paper builds on and that a newcomer needs, each taught from scratch as described above, in the
order they build on each other (a "###" heading per concept). This is the foundation of the whole guide: give it
the space it needs. Teach the ideas central to the paper, including the earlier approaches it improves on and how
they work, not only basic math.
## Words you'll meet
The hard technical terms of the paper as a table "Term | In plain words | What it means in this paper", and the
distinctions between terms that are easy to confuse.
## The key idea
What problem the authors solve, why the existing approaches fall short (concretely: what goes wrong, with an
example), the central insight, the proposed solution, and what makes it different. A high-level mental model before
any equation; a small diagram of the overall idea.
Then one "##" section per main part of the method, in the paper's order and named after it (for example each
component of an architecture, each stage of a procedure, each step of an experiment design or derivation). In each:
what it is for, the intuition, how it works step by step, its formulas (as described above), a worked example with
numbers, how it connects to the other parts, and why it's designed that way rather than another way. Point at the
paper's figure where it shows the part you explain.
## Putting it together
The complete method end to end: how information, material or data flows through it, in order, with a diagram; how it
is trained, fitted, run or carried out; the costs (time, memory, samples, money) and the implementation choices
that matter.
## Experiments and results
The data, benchmarks or samples; what it was compared against; the measures used and what they mean; the setup; the
main results with their actual numbers (a table or a ```chart); the ablations or controls. Don't just repeat tables:
explain what each result shows and what we can conclude from it.
## What it shows, and what it doesn't
A table "Claim | What the evidence supports" separating what the paper demonstrates from what the authors only
suggest; the assumptions the approach depends on; its limitations and what could be improved.
## Since then
Only what you are sure of: how later work built on it, and where it is used now. Say clearly that this is outside
the paper and separate it from the paper's own contribution.
## Takeaways
The ideas to remember, one sentence each, and the key formulas with what each means in a small table.

Cite the paper as you go. Take the length it needs (this guide is meant to be long), but every paragraph must teach:
no filler, no repetition.""",
}
FOLLOWUPS = ("After your answer, add a fenced block ```followups with two or three short questions (one per line, "
             "under 10 words each) the reader might want to ask next. Nothing after that block.")
KEEP_TURNS = 16  # earlier messages given back to the model; older ones are left out
LONG_ANSWER = 6000  # earlier answers longer than this are shortened when given back


def _figures_list(figures: list[dict]) -> str:
    if not figures:
        return "<figures>None found in the PDF.</figures>"
    rows = [f"{'Figure' if f['kind'] == 'figure' else 'Table'} {f['number']} (page {f['page']}): {f['caption'][:200]}" for f in figures]
    return "<figures>\n" + "\n".join(rows) + "\n</figures>"


def _turn(m: dict, language: str, last: bool) -> str:
    """One message of the conversation as the model reads it: attached passages, the question, and (for the message
    being answered now) what to do."""
    def passage(a: dict) -> str:
        where = f' from="{a["label"]}"' if a.get("label") else ""
        return f"<passage{where}>\n{a['text']}\n</passage>"

    parts = [passage(a) for a in m.get("attachments", []) if a.get("text")]
    kind = m.get("kind") or "ask"
    if m.get("content"):
        parts.append(f"My question: {m['content']}" if parts else m["content"])
    if last:
        if kind != "ask" or not m.get("content"):
            task = TASKS[kind]
            parts.append(task.format(language=language or "the reader's language") if kind == "translate" else task)
        else:
            parts.append(TASKS["ask"])
        if kind not in ("translate", "guide"):  # a guide is read in its own reader, without follow-ups
            parts.append(FOLLOWUPS)
    elif kind in ("explain", "simplify", "translate") and not m.get("content"):
        parts.append(f"({kind.capitalize()} this.)")
    return "\n\n".join(parts) or "(empty)"


def conversation_stream(paper: dict, turns: list[dict], language: str = "", figures: list[dict] | None = None):
    """The answer to the last message of a conversation, as it is written (str pieces; Thinking for reasoning).
    `turns`: [{role, kind, content, attachments}] oldest first, ending with the reader's new message.
    `figures`: the paper's figures and tables ({kind, number, page, caption}) the answer may show or cite."""
    turns = turns[-KEEP_TURNS:]
    while turns and turns[0]["role"] != "user":
        turns = turns[1:]
    system = [
        {"type": "text", "text": tutor()},
        {"type": "text", "text": _paper_context(paper) + "\n\n" + _figures_list(figures or []),
         "cache_control": {"type": "ephemeral"}},
    ]
    messages = []
    for i, m in enumerate(turns):
        if m["role"] == "user":
            messages.append({"role": "user", "content": _turn(m, language, i == len(turns) - 1)})
        else:
            text = m.get("content") or "(no answer)"
            messages.append({"role": "assistant", "content": text if len(text) <= LONG_ANSWER else text[:LONG_ANSWER] + " […]"})
    return ai.stream(system, messages)


class QuizItem(BaseModel):
    question: str
    answer: str


class Quiz(BaseModel):
    questions: list[QuizItem]


def quiz(paper: dict) -> list[dict]:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "I just finished reading this paper. Write 5 open questions that check real understanding "
        "(the core idea, why the method works, what the results show, limitations, how it relates "
        "to prior work), not trivia. Give a short reference answer for each."
    )
    return [q.model_dump() for q in ai.parse(prompt, Quiz).questions]


def more_questions(paper: dict, existing: list[dict], count: int = 5) -> list[dict]:
    """New questions for a paper that already has some: about other things, not the same ones reworded."""
    asked = "\n".join(f"- {q['question']}" for q in existing)
    prompt = (
        f"{_paper_context(paper)}\n\n"
        f"I'm testing myself on this paper and already have these questions:\n{asked}\n\n"
        f"Write {count} more open questions that check real understanding of things those don't cover: other "
        "sections, the details of the method, the experiments and what they do and don't show, assumptions, "
        "what would happen if a part were changed. No trivia, and none that repeats one above in other words. "
        "Give a short reference answer for each."
    )
    return [q.model_dump() for q in ai.parse(prompt, Quiz).questions][:count]


class GradeItem(BaseModel):
    score: float
    feedback: str


class Grades(BaseModel):
    results: list[GradeItem]


def grade(paper: dict, quiz: list[dict], answers: list[str]) -> dict:
    pairs = "\n\n".join(
        f"<item>\n<question>{q['question']}</question>\n<reference>{q['answer']}</reference>\n"
        f"<student_answer>{a}</student_answer>\n</item>"
        for q, a in zip(quiz, answers)
    )
    prompt = (
        f"{_paper_context(paper)}\n\n{pairs}\n\n"
        "Grade each answer against the paper: score 0 to 1 for how well it shows understanding "
        "(wording does not matter), and one or two sentences of feedback that correct or deepen it."
    )
    results = [r.model_dump() for r in ai.parse(prompt, Grades).results]
    return {"results": results, "score": sum(r["score"] for r in results) / max(len(results), 1)}


class Match(BaseModel):
    paper_id: int
    reason: str


class Matches(BaseModel):
    matches: list[Match]


def recall(idea: str, candidates: list[dict]) -> list[dict]:
    papers = "\n\n".join(
        f"<paper id=\"{c['id']}\">\n<title>{c['title']}</title>\n<abstract>{c['abstract']}</abstract>\n"
        f"<summary>{c.get('skim') or ''}</summary>\n<excerpt>{c.get('snippet') or ''}</excerpt>\n</paper>"
        for c in candidates
    )
    prompt = (
        f"I remember this idea but not which paper I read it in:\n<idea>{idea}</idea>\n\n"
        f"Papers I have read:\n{papers}\n\n"
        "Return the papers that contain this idea, best match first, each with one sentence on "
        "where or how the paper presents it. Return an empty list if none fit."
    )
    return [m.model_dump() for m in ai.parse(prompt, Matches, effort="low").matches]
