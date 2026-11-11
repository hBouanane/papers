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


# Small (often local) models can't take a whole paper; Settings can cap how much of it is sent.
CONTEXT_CHARS = {"32k": 100_000, "8k": 24_000}


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


class Skim(BaseModel):
    tldr: str
    problem: str
    key_idea: str
    contributions: list[str]
    method: str
    results: list[str]
    limitations: list[str]
    figures: list[str]
    questions: list[str]
    reading_plan: list[str]
    relevance: str
    verdict: str


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
    """A first pass the way Andrew Ng teaches it: title, abstract and figures, then introduction,
    conclusion and section headings, skipping related work and dense math. Written for a reader
    whose first language may not be English, and shaped by what they are working on."""
    prompt = (
        f"{_paper_context(paper)}\n\n"
        + (f"<my_goal>{goal}</my_goal>\n\n" if goal else "")
        + "Give me the first pass on this paper, as Andrew Ng recommends doing it: look at the title, "
        "abstract and figures first, then the introduction, conclusion and section headings; skip related "
        "work and dense math. I may not be a native English speaker, so write in plain, simple English: short "
        "sentences, everyday words, technical terms only when needed (and say what they mean).\n\n"
        "Fill in:\n"
        "- tldr: what the paper does and why it matters, in two or three sentences a newcomer understands.\n"
        "- problem: the problem it tackles and why earlier work falls short.\n"
        "- key_idea: the one idea that makes it work, in one sentence.\n"
        "- contributions: what is new, one sentence each.\n"
        "- method: how it works, in a few sentences, with an intuition rather than equations.\n"
        "- results: the main results, with the actual numbers and what they are compared against.\n"
        "- limitations: weaknesses the authors admit, plus obvious ones they don't.\n"
        "- figures: the figures and tables worth looking at first, each as 'Figure N: what it shows'.\n"
        "- questions: 3 to 5 questions to keep in mind while reading, which the paper answers.\n"
        "- reading_plan: the sections to read, in order, each as 'Section: why, about N minutes'; mark the "
        "ones to read closely and the ones to skip.\n"
        "- relevance: " + ("how this paper helps with my goal, concretely; say so plainly if it doesn't."
                           if goal else "leave empty.") + "\n"
        "- verdict: one line on whether to read it fully, skim it, or skip it, and why."
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
its own line; when text copied from a PDF lost superscripts or subscripts (like "100002i/dmodel"), write the formula
correctly and say that the copy lost them. Cite the paper wherever it helps the reader check you: [§3.4] for a
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
- Numbers to compare (results from a table, a trend, a distribution): any Vega-Lite v5 spec (bars, lines, points,
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
  (flows of amounts). Keep labels short, quote labels that have symbols:
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
    return TUTOR + ("\n\n" + PAGES if ai.setting("ai_pages") == "on" else "")

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
        if kind != "translate":
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
