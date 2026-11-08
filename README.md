# Papers

An AI reading companion for research papers. Define what you are working on, get relevant
papers, skim them Andrew Ng–style, read with an explainer that knows the whole paper, track
where you stopped, quiz yourself when you finish, ask "where did I read this idea?", and follow
reference chains. See [SPEC.md](SPEC.md) for the design.

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
export ANTHROPIC_API_KEY=sk-ant-...             # needed for AI features
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Open http://localhost:8000.

Optional env vars: `S2_API_KEY` (Semantic Scholar key; without it search often falls back to
arXiv because of rate limits), `PAPERS_MODEL` (default `claude-opus-5-5`), `PAPERS_DB`
(default `data/papers.db`; uploaded and downloaded PDFs are kept next to it in `pdfs/`).

## Library folder

In Settings, choose a folder and the app keeps a copy of your library there: one folder per
goal (`Unsorted` for the rest), each paper as `Author et al. Year - Title.pdf` with a `.md`
notes file next to it (key points, explanations, quiz, `[[links]]` to related papers).
PDFs dropped into its `Inbox` folder are imported within about 10 seconds
(`PAPERS_INBOX_POLL` sets the interval; `0` turns the watcher off).

## Test

```bash
.venv/Scripts/python -m pytest -q
```

All AI and network calls are faked in tests.
