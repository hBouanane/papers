"""The tools the agent can use while it answers (Deep mode). Each is a plain function on the paper being read:
read tools look things up precisely, and (later) act tools add notes, words and highlights.

Every tool has a short label shown to the reader while it runs ("Reading §3.5"), a JSON schema for the model, and
returns a Result: text for the model, an optional image (a figure it can look at), and a one-line summary for the
steps list.
"""
import base64
import re
from dataclasses import dataclass, field

from papers import db, figures, index
from papers import notes as notes_db
from papers.ai import providers
from papers.store import get_paper


@dataclass
class Result:
    text: str
    summary: str = ""
    image: bytes | None = None  # PNG
    data: dict = field(default_factory=dict)  # for act tools: what was done (for Undo)

    def image_b64(self) -> str:
        return base64.b64encode(self.image).decode() if self.image else ""


# ---------- Finding things in the paper's text ----------
NUMBERED = re.compile(r"(?:^|\s)(\d{1,2}(?:\.\d{1,2}){0,3})\s+(?=[A-Z])")
SMALL = {"and", "of", "the", "for", "with", "to", "in", "on", "a", "an", "by", "via", "vs", "from", "as", "at", "or"}
NOT_HEADINGS = ("Figure", "Table", "Fig", "Eq", "Equation", "Algorithm", "Published", "Under", "Preprint", "Proceedings", "arXiv")
OPENERS = {"We", "In", "Here", "This", "The", "Our", "It", "As", "For", "These", "That", "To", "On", "A", "An", "If", "When",
           "Available", "Note", "See", "Then", "Thus", "However", "Since", "From", "With", "At", "By", "Each", "All"}
SMALL_CAPS = re.compile(r"\b([A-Z]) ([A-Z]{2,})\b")  # "I NTRODUCTION": small capitals split by the PDF's text


def _title(after: str) -> str:
    """A heading's title from the text after its number: words until the next sentence starts ("Encoder and Decoder
    Stacks | The encoder is composed of...", "Embeddings and Softmax | Similarly to the...")."""
    words = SMALL_CAPS.sub(r"\1\2", after).split()[:14]
    lower = lambda w: w[:1].islower()  # noqa: E731
    title = []
    for i, w in enumerate(words):
        nxt = words[i + 1] if i + 1 < len(words) else ""
        then = words[i + 2] if i + 2 < len(words) else ""
        if w[:1].isdigit():
            break  # the next heading's number
        if lower(w) and w.lower() not in SMALL:
            break
        # a capitalised word that starts a sentence: "The encoder", "Similarly to the", "Instead of using"
        if i and w[:1].isupper() and lower(nxt) and (nxt.lower() not in SMALL or lower(then)):
            break
        title.append(w)
        if len(title) == 8 or w.endswith((".", ":")):
            break
    title = " ".join(title).rstrip(".:")
    return title.title() if title.isupper() and len(title) > 3 else title  # "INTRODUCTION" → "Introduction"


def sections(text: str) -> list[dict]:
    """The numbered sections found in the text, in order: [{number, title, start}]. Each must follow the one before
    (3.1 after 3, 3.2 after 3.1.4, 4 after 3.2), so page numbers, dates and figure numbers are left out, and so are
    running headers ("3 Published as a conference paper...") and sentences after a page number ("6 We show")."""
    found, last = [], (0,)
    for m in NUMBERED.finditer(text):
        number = tuple(int(x) for x in m.group(1).split("."))
        # what may come next: a first subsection, or the next number at any level, allowing a few missed headings
        # (up to 4 within a section, 2 between top-level ones; a page number like 12 after 7 is too far)
        nexts = {last + (1,)} | {last[:k] + (last[k] + d,) for k in range(len(last)) for d in range(1, 3 if k == 0 else 5)}
        if number not in nexts:
            continue
        title = _title(text[m.end():m.end() + 200])
        words = title.split()
        if not title or words[0].rstrip(".:") in NOT_HEADINGS or title.endswith(","):
            continue
        if words[0] in OPENERS and (len(words) == 1 or words[1][:1].islower()):
            continue  # "6 We show...", "7 In this...": a sentence after a page number, not a heading
        found.append({"number": ".".join(map(str, number)), "title": title, "start": m.start(1)})
        last = number
    return found


def chunks(text: str, size: int = 900) -> list[dict]:
    """The text in overlapping pieces, each knowing its section."""
    secs = sections(text)
    out = []
    for start in range(0, max(len(text), 1), size - 150):
        piece = text[start:start + size]
        if not piece.strip():
            continue
        sec = next((s for s in reversed(secs) if s["start"] <= start + 100), None)
        out.append({"start": start, "text": piece, "section": f"§{sec['number']} {sec['title']}" if sec else ""})
    return out


def _words(s: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2]


# ---------- Read tools ----------
def search_paper(paper: dict, query: str, limit: int = 5) -> Result:
    text = paper.get("text") or ""
    if not text:
        return Result("This paper has no text (no PDF was added).", "No text to search")
    terms = set(_words(query))
    scored = []
    for c in chunks(text):
        words = _words(c["text"])
        score = sum(words.count(t) for t in terms) + 3 * sum(1 for t in terms if t in words)
        if score:
            scored.append((score, c))
    scored.sort(key=lambda x: -x[0])
    best = [c for _, c in scored[:limit]]
    if not best:
        return Result(f'Nothing in the paper matches "{query}".', f"Searched “{query}”: nothing")
    body = "\n\n".join(f"[{c['section'] or 'start of the paper'}, about {round(100 * c['start'] / len(text))}% in]\n{c['text']}" for c in best)
    return Result(body, f"Searched “{query}”")


def read_section(paper: dict, section: str) -> Result:
    text = paper.get("text") or ""
    secs = sections(text)
    want = section.strip().lstrip("§").strip().lower()
    hit = next((s for s in secs if s["number"] == want.split()[0]), None) if want and want[0].isdigit() else None
    hit = hit or next((s for s in secs if want and want in s["title"].lower()), None)
    if not hit:
        names = ", ".join(f"{s['number']} {s['title']}" for s in secs[:40])
        return Result(f'No section "{section}". The sections are: {names or "(none found)"}', f"Looked for §{section}")
    depth = hit["number"].count(".")
    after = next((s for s in secs if s["start"] > hit["start"] and s["number"].count(".") <= depth), None)
    body = text[hit["start"]:after["start"] if after else hit["start"] + 8000][:8000]
    return Result(body, f"Read §{hit['number']} {hit['title']}")


def _figure(paper: dict, kind: str, number: int) -> dict | None:
    return next((f for f in figures.for_paper(paper["id"]) if f["kind"] == kind and f["number"] == number), None)


def look_at_figure(paper: dict, number: int, kind: str = "figure") -> Result:
    kind = "table" if kind.lower().startswith("tab") else "figure"
    name = "Table" if kind == "table" else "Figure"
    f = _figure(paper, kind, int(number))
    if not f:
        have = ", ".join(f"{'Table' if x['kind'] == 'table' else 'Figure'} {x['number']}" for x in figures.for_paper(paper["id"]))
        return Result(f"{name} {number} wasn't found in the PDF. Found: {have or 'none'}.", f"Looked for {name} {number}")
    text = paper.get("text") or ""
    mentions = [m.start() for m in re.finditer(rf"\b{name}\s+{number}\b", text)][:3]
    around = "\n…\n".join(text[max(0, i - 300):i + 400] for i in mentions)
    about = f"{f['caption']} (page {f['page']}).\nWhere the paper mentions it:\n{around or '(not mentioned in the text)'}"
    if not can_see():
        return Result(about + "\n\nYou were given the caption and the text only, not the image (this model isn't sent "
                      "images). Don't describe what the image looks like, and don't put boxes on it.",
                      f"Read about {name} {number} (the image isn't sent to this model)")
    image = (figures.folder(paper["id"]) / figures.image_name(kind, f["number"])).read_bytes()
    grid = figures.with_grid(image)
    if not grid:
        return Result(about + "\n\nShow it without boxes.", f"Looked at {name} {number}", image=image)
    return Result(about + POINTING, f"Looked at {name} {number}", image=grid)


POINTING = """

The image has a grid drawn over it, for you only (the reader sees the figure without it): columns A to J from left to
right, rows 1 to 10 from top to bottom, each cell named in its corner. To point at a part of the figure, name the
cells it covers in a ```figure block: "from" is the cell at its top-left corner, "to" the cell at its bottom-right
corner, for example {"figure": 1, "boxes": [{"from": "B3", "to": "E5", "label": "the encoder stack"}]}. Read the cell
names off the image; cover the whole part and nothing else. If you can't tell exactly where a part is, leave the
box out."""


def can_see() -> bool:
    """Whether the model gets the figure's image: always, except OpenAI-compatible models with images turned off."""
    return providers.backend() != "openai" or setting_vision()


def seen(steps: list[dict]) -> set[tuple[str, int]]:
    """The figures and tables the model really looked at in an answer, from its steps."""
    found = set()
    for s in steps:
        m = re.match(r"Looked at (Figure|Table) (\d+)$", s.get("summary") or "")
        if m and s.get("name") == "look_at_figure":
            found.add((m.group(1).lower(), int(m.group(2))))
    return found


def search_library(paper: dict, idea: str) -> Result:
    found = [c for c in index.candidates(idea, limit=6) if c["id"] != paper["id"]]
    if not found:
        return Result("No other paper in the library matches.", f"Searched your library for “{idea}”")
    body = "\n\n".join(f"{c['title']}: {c.get('snippet') or c.get('abstract', '')[:300]}" for c in found)
    return Result(body, f"Searched your library for “{idea}”")


def get_notes(paper: dict) -> Result:
    items = notes_db.list_for(paper["id"])
    if not items:
        return Result("The reader has no notes or highlights on this paper.", "Read your notes: none")
    body = "\n".join(f"- {'Highlight' if n['kind'] == 'highlight' else 'Note'}: {n['quote'] or ''} {n['body'] or ''}".strip() for n in items)
    return Result(body, f"Read your notes ({len(items)})")


def get_vocabulary(paper: dict) -> Result:
    words = paper.get("glossary") or []
    if not words:
        return Result("No vocabulary list for this paper yet.", "Read the word list: empty")
    return Result("\n".join(f"- {w['term']}: {w['meaning']}" for w in words), f"Read the word list ({len(words)})")


# ---------- Act tools: they change the reader's library, so each says what it did and can be undone ----------
def _notes_changed(paper_id: int) -> None:
    from papers import library  # late import: library pulls in a lot
    library.refresh_notes_text(paper_id)
    library.sync_paper(paper_id, follow_parent=False)


def save_note(paper: dict, text: str, quote: str = "") -> Result:
    text = text.strip()
    if not text:
        return Result("A note needs some text.", "Didn't save an empty note")
    note = notes_db.add(paper["id"], kind="note", body=text[:6000], quote=quote.strip()[:2000], source="ai",
                        position=_position(paper, quote))
    _notes_changed(paper["id"])
    short = text if len(text) <= 60 else text[:60].rsplit(" ", 1)[0] + "…"
    return Result("Saved the note.", f"Saved a note: “{short}”", data={"kind": "note", "id": note["id"], "label": f"Saved a note: “{short}”"})


def highlight(paper: dict, quote: str, color: str = "yellow") -> Result:
    quote = re.sub(r"\s+", " ", quote).strip()
    text = re.sub(r"\s+", " ", paper.get("text") or "")
    if len(quote) < 3 or quote.lower() not in text.lower():
        return Result("That exact text isn't in the paper; quote it exactly, as it appears.", "Couldn't find the passage to highlight")
    color = color if color in notes_db.COLORS else "yellow"
    note = notes_db.add(paper["id"], kind="highlight", quote=quote[:2000], color=color, source="ai", position=_position(paper, quote))
    _notes_changed(paper["id"])
    short = quote if len(quote) <= 50 else quote[:50].rsplit(" ", 1)[0] + "…"
    return Result("Highlighted it.", f"Highlighted “{short}”", data={"kind": "highlight", "id": note["id"], "label": f"Highlighted “{short}”"})


def save_word(paper: dict, term: str, meaning: str, kind: str = "technical", example: str = "", translation: str = "") -> Result:
    import json

    from papers.store import update_paper
    term = term.strip()
    words = paper.get("glossary") or []
    if not term or any(w["term"].lower() == term.lower() for w in words):
        return Result(f"“{term}” is already in the word list.", f"“{term}” was already in the word list")
    word = {"term": term, "kind": "english" if kind == "english" else "technical", "meaning": meaning.strip(),
            "example": example.strip(), "translation": translation.strip(), "source": "ai"}
    update_paper(paper["id"], glossary=json.dumps([*words, word]))
    return Result(f"Added “{term}” to the word list.", f"Added “{term}” to the word list",
                  data={"kind": "word", "term": term, "label": f"Added “{term}” to the word list"})


def add_paper(paper: dict, title: str) -> Result:
    import asyncio
    import threading

    from fastapi import BackgroundTasks

    from papers.routes.papers import PaperIn, create_paper
    from papers.store import find_existing
    title = title.strip()
    if existing := find_existing({"title": title}):
        return Result(f"“{title}” is already in the library (paper {existing}).", f"“{title}” was already in your library")
    tasks = BackgroundTasks()
    added = create_paper(PaperIn(title=title, source_paper_id=paper["id"]), tasks)
    threading.Thread(target=lambda: asyncio.run(tasks()), daemon=True).start()  # the AI reads it ahead, in the background
    return Result(f"Added “{added['title']}” to the library, linked from this paper on the Map.",
                  f"Added “{added['title']}” to your library",
                  data={"kind": "paper", "id": added["id"], "label": f"Added “{added['title']}” to your library"})


def _position(paper: dict, quote: str) -> float:
    """Where a quote is in the paper (0 to 1), so a note made by the AI sits in the right place in the list."""
    text = paper.get("text") or ""
    at = text.lower().find(quote.strip().lower()[:60]) if quote.strip() else -1
    return round(at / len(text), 4) if at >= 0 and text else 0


# ---------- The registry ----------
def _schema(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


TOOLS = {
    "search_paper": {
        "fn": search_paper, "label": "Searching the paper",
        "description": "Find passages in this paper about something (keywords). Returns the passages with their section.",
        "schema": _schema({"query": {"type": "string", "description": "a few keywords"}}, ["query"]),
    },
    "read_section": {
        "fn": read_section, "label": "Reading a section",
        "description": "Read one section of the paper in full, by number ('3.5') or title. Lists the sections if not found.",
        "schema": _schema({"section": {"type": "string"}}, ["section"]),
    },
    "look_at_figure": {
        "fn": look_at_figure, "label": "Looking at a figure",
        "description": "See one of the paper's figures or tables (the image, its caption and where the text mentions it).",
        "schema": _schema({"number": {"type": "integer"}, "kind": {"type": "string", "enum": ["figure", "table"]}}, ["number", "kind"]),
    },
    "search_library": {
        "fn": search_library, "label": "Searching your library",
        "description": "Find the reader's other papers about an idea, to connect this paper to what they read before.",
        "schema": _schema({"idea": {"type": "string"}}, ["idea"]),
    },
    "get_notes": {
        "fn": get_notes, "label": "Reading your notes",
        "description": "The reader's notes and highlights on this paper.", "schema": _schema({}, []),
    },
    "get_vocabulary": {
        "fn": get_vocabulary, "label": "Reading the word list",
        "description": "The paper's hard words with their meanings (what the reader is learning).", "schema": _schema({}, []),
    },
    # Act tools: only when the reader asks for it (or clearly wants it); each can be undone.
    "save_note": {
        "fn": save_note, "label": "Saving a note", "act": True,
        "description": "Save a note on this paper for the reader (only when they ask, e.g. 'note that', 'save this'). "
                       "Optionally the passage it's about, quoted exactly.",
        "schema": _schema({"text": {"type": "string"}, "quote": {"type": "string"}}, ["text", "quote"]),
    },
    "highlight": {
        "fn": highlight, "label": "Highlighting", "act": True,
        "description": "Highlight a passage of the paper for the reader (only when they ask). Quote it exactly as it appears.",
        "schema": _schema({"quote": {"type": "string"}, "color": {"type": "string", "enum": list(notes_db.COLORS)}}, ["quote", "color"]),
    },
    "save_word": {
        "fn": save_word, "label": "Adding a word", "act": True,
        "description": "Add a word or phrase to the paper's word list, with its meaning here in simple English (when the "
                       "reader asks, or wants to learn it). kind: 'technical' or 'english' (a general English word).",
        "schema": _schema({"term": {"type": "string"}, "meaning": {"type": "string"},
                           "kind": {"type": "string", "enum": ["technical", "english"]}, "example": {"type": "string"},
                           "translation": {"type": "string"}}, ["term", "meaning", "kind", "example", "translation"]),
    },
    "add_paper": {
        "fn": add_paper, "label": "Adding a paper", "act": True,
        "description": "Add a paper this one cites (or that the reader names) to their library, linked from this paper on "
                       "their Map. Only when the reader asks to read or add it. Give its exact title.",
        "schema": _schema({"title": {"type": "string"}}, ["title"]),
    },
}


def run(name: str, paper_id: int, args: dict) -> Result:
    """Run a tool by name; errors come back as text for the model, not exceptions."""
    tool = TOOLS.get(name)
    if not tool:
        return Result(f"There is no tool called {name}.", f"Unknown tool {name}")
    try:
        paper = get_paper(paper_id)
        return tool["fn"](paper, **{k: v for k, v in (args or {}).items() if k in tool["schema"]["properties"]})
    except Exception as e:  # the model sees what went wrong and can carry on
        return Result(f"The tool failed: {e}", f"{tool['label']}: failed")


def specs() -> list[dict]:
    return [{"name": n, "description": t["description"], "schema": t["schema"]} for n, t in TOOLS.items()]


def setting_vision() -> bool:
    """Whether to send figure images to OpenAI-compatible models (many local and free ones can't take images)."""
    return db.setting("ai_vision") == "on"
