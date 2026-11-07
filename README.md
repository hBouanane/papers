# Papers

An AI reading companion for research papers. Define what you are working on, get relevant
papers, skim them Andrew Ng–style, read with an explainer that knows the whole paper, track
where you stopped, quiz yourself when you finish, ask "where did I read this idea?", and follow
reference chains. See [SPEC.md](SPEC.md) for the design.

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
export ANTHROPIC_API_KEY=sk-ant-...             # or use your Claude subscription, see below
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Open http://localhost:8000.

Optional env vars: `S2_API_KEY` (Semantic Scholar key; without it search often falls back to
arXiv because of rate limits), `PAPERS_MODEL` (default `claude-opus-5-5`), `PAPERS_DB`
(default `data/papers.db`; uploaded and downloaded PDFs are kept next to it in `pdfs/`).


## Choosing an AI model

Settings > AI model offers three ways:

- **My Claude subscription** (Pro, Max): runs Claude Code on your computer, signed in with your account. For your own use only.
- **API key**: Claude on the Anthropic API (`ANTHROPIC_API_KEY`).
- **Another model**: any OpenAI-compatible provider. Pick one, paste its key, click **List models** and choose:
  OpenAI (ChatGPT), Google Gemini, Mistral, Groq, OpenRouter (hundreds of models), or a model on your own computer
  with [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) (no key, nothing leaves your machine).
  Under *More options* you can point it at any other server (vLLM, llama.cpp, a company gateway) and, for small local
  models, send only the first part of long papers.

Keys are stored only in your local database (`data/papers.db`) and never sent back to the page.

## Using your Claude subscription

Instead of an API key you can use your Claude Pro or Max plan: in **Settings → Claude** choose
*My Claude subscription*. The app then runs the official Claude Code CLI on your computer
(`claude -p`, no tools), which signs in with your own Claude account; usage counts toward your
plan's limits. Install Claude Code, run `claude` once and type `/login` to sign in. The app never
reads or stores your Claude credentials. This is for your own use: don't host the app for others
on your subscription. `PAPERS_CLAUDE_BIN` points at a specific `claude` binary if needed.

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
