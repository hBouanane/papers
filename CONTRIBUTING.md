# Contributing to Papers

Thanks for helping. Papers is a small app on purpose: a Python server (FastAPI) and a web page made of plain
JavaScript modules, with no build step. If you can read Python and JavaScript, you can change any part of it.

## Set up

```bash
git clone https://github.com/hBouanane/papers && cd papers
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"            # macOS/Linux: .venv/bin/pip
.venv/Scripts/uvicorn papers.main:app --reload    # http://localhost:8000; restarts when Python changes
```

The web files are served as they are: edit them and reload the page. To try things without touching your own
library, point the app at another folder: `PAPERS_DATA=./scratch` (or `papers --data ./scratch`).

Before sending a pull request:

```bash
.venv/Scripts/ruff check papers tests    # style and common mistakes (`--fix` repairs most)
.venv/Scripts/pytest -q                  # all AI and network calls are faked; no keys needed
```

CI runs both on Python 3.11 to 3.13 and checks that the Docker image starts.

## How the code is laid out

```
papers/
  cli.py            the `papers` command: options, then starts the server and opens the browser
  config.py         where data lives (the data folder, and config.json which remembers the chosen one) and every
                    environment variable
  setup.py          the first-run setup in the terminal (banner, data folder, library folder, AI); `papers setup`
  storage.py        what is kept where, with sizes, and moving the data folder (Settings › Where everything is kept)
  main.py           builds the app: the routers below, error handling, the web files, the Inbox watcher

  routes/           the HTTP API, one file per part of the app
    papers.py         add (search result, link, PDF), list, edit, delete, the PDF file, prepare
    goals.py          goals (stored as "topics"), finding papers for them, the reading roadmap, BibTeX export
    reading.py        progress, finishing, figures and tables, references, the chain a paper is in
    learning.py       key points, vocabulary, explain/translate/ask (streamed), quiz and spaced review
    notes.py          notes and highlights
    recall.py         full-text search and "which paper had this idea?"
    settings.py       name, language, AI provider, what the AI can do, storage (show and move), the folder picker

  store.py          reading and writing papers; every change also updates the search index and the folder
  ingest.py         turning a PDF into a paper, the Inbox, and preparing papers ahead of time with the AI
  llm.py            every prompt: one function per task (skim, explain, glossary, quiz, grade, recall, ...), and the
                    tutor's rules for conversations (TUTOR, TASKS: how Explain, Simplify, Translate and questions answer)
  ai/               getting a prompt to the chosen model and its answer back; streaming.py: thinking vs answer, Stop,
                    and giving up on a silent model
  chat/             conversations: store.py (conversations and messages), answer.py (streams an answer and saves it)
  agent/            Deep mode: tools.py (what the AI can look up and do), loop.py (the tool loop for each provider),
                    mcp_server.py (the same tools for Claude Code)
    providers.py      the provider list and which one is chosen, with its key, model and address
    anthropic_api.py  claude_code.py  codex.py  openai_compat.py   one file per way of reaching a model

  db.py             SQLite schema, migrations and settings     index.py   full-text search (SQLite FTS5)
  pdf.py            text, titles and abstracts out of PDFs     figures.py figures and tables cut out of PDFs
  scholar.py        Semantic Scholar and arXiv                 library.py the library folder (PDFs + Markdown notes)
  notes.py          notes and highlights storage               folders.py the folder picker
  bibtex.py         BibTeX entries
  roadmap.py        a goal's reading roadmap: search widely, let the AI pick and order papers in stages, add the
                    chosen ones to the goal and fetch their PDFs in the background

  static/           the web app (no build step; ES modules loaded by the browser)
    index.html        the page shell; links the stylesheets below in order
    css/              styles by area, each file building on the ones before it:
                        tokens (colours, shadows, fonts for light, dim and dark), base (type, page, top bar,
                        theme switch, toast), components (buttons, cards, menus, covers, notes, vocabulary,
                        combobox, folder picker), then one per screen: library, goals, recall, map, paper
                        (overview, figures, review), reader, settings
    js/main.js        routes each #/address to a page; paste and drop anywhere to add papers
    js/core.js        shared helpers: api(), toast(), paper rows, markdown, the top bar
    js/pages/         one file per screen: library, goals, recall, map, settings (+ shared.js)
    js/paper/         a paper's screens: overview, reader, review, figures (+ shared.js)
    js/paper/reader/  the reader's parts, wired together by readerPage() in reader.js; they share one
                      state object (state.js: the paper, the page's elements, the open view):
                        layout (markup), bar (one-row bar and its ⋯ menu), route (the pill at the bottom),
                        views (PDF or Text, Go to…, back to where you stopped), progress (what you've read,
                        skimming), selection (the bar on selected text), highlighter, panel (Ask, Words,
                        Notes; streamed answers), finish, zoom, keys (shortcuts), terms + vocab (the Words switch:
                        hard words marked in the page, with a card for each)
    js/components/    reusable widgets: combobox (searchable dropdown), folderpicker
    js/chat/          the conversation panel: conversation.js (History, composer, Quick/Deep), answer.js (an answer
                      being written), stream.js, render.js (Markdown, math, citations, visuals), widgets.js,
                      canvas.js (a visual opened large)
    js/*.js           shared by the paper screens: pdfview (PDF.js), textview, highlights, notes, tracker,
                      speech, readprefs (font, size, page tone), covers (first-page thumbnails), theme

tests/              one file per feature, using FastAPI's test client against a temporary database
```

Two rules keep it easy to follow:

- **Routes stay thin.** A route checks its input (the pydantic `...In` classes), calls `store`, `ingest` or
  `llm`, and returns JSON. Logic that isn't about HTTP goes in a module next to them.
- **The AI is only reached through `llm.py`.** Pages and routes never build prompts; tests replace the `llm`
  functions with fakes (see `tests/conftest.py`, which also blocks any real AI call).

## Common changes

| You want to | Look at |
| --- | --- |
| Change what the AI writes (key points, quiz, ...) | the prompt in `papers/llm.py` |
| Change how Explain or Simplify answer | `TASKS` in `papers/llm.py` (the rules all answers follow are `TUTOR`) |
| Give the AI a new tool in Deep mode | a function and an entry in `TOOLS`, `papers/agent/tools.py` (`"act": True` if it changes the library, with `data` for Undo) |
| Add a kind of visual | a fenced block in `papers/static/js/chat/render.js` (or a widget in `widgets.js`), and a line in `TUTOR` |
| Add a provider that speaks the OpenAI chat API | one line in `PROVIDERS`, `papers/ai/providers.py` |
| Add a provider with its own API | a module in `papers/ai/` with `parse()` and `stream()`, and a branch in `ai/__init__.py` |
| Add an API endpoint | the matching file in `papers/routes/` (a new area gets a new file, added to `routes/__init__.py`) |
| Add a column or table | `SCHEMA` and the migrations in `papers/db.py` |
| Add a screen | a file in `static/js/pages/` and a line in the `routes` list of `static/js/main.js` |
| Change colours or spacing | `static/css/tokens.css` (see [DESIGN.md](DESIGN.md)) |
| Change how a screen looks | its file in `static/css/`; shared pieces are in `components.css` |
| Change something in the reader | its part in `static/js/paper/reader/` (each file says what it does at the top) |

## Style

- Python: `ruff` settings in `pyproject.toml` (120 columns). Type hints on public functions; a docstring when
  the name doesn't say it all.
- JavaScript: ES modules, no framework, no build. Keep markup in template strings next to the code that
  wires it up, and escape anything from the server or the user with `esc()`.
- Text the user reads: short, plain sentences; say what to do, not what went wrong inside.
- Light, dim and dark themes all need to look right, and motion respects `prefers-reduced-motion`.

## Releasing

Bump `__version__` in `papers/__init__.py` and push a tag like `v0.2.0`. The release workflow publishes to PyPI
and pushes the Docker image to `ghcr.io`.
