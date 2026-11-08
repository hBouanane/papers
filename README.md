# Papers

An AI reading companion for research papers. Define what you are working on, get relevant
papers, skim them Andrew Ng–style, read with an explainer that knows the whole paper, track
where you stopped, quiz yourself when you finish, ask "where did I read this idea?", and follow
reference chains. It runs on your computer; your papers and notes stay there.
See [SPEC.md](SPEC.md) for the design.

## Install

With Python 3.11 or newer, one command (like `npx` for Node):

```bash
uvx papers-app
```

or install it to keep it around, then start it with `papers`:

```bash
pipx install papers-app
```

`papers` opens http://localhost:8000 in your browser. Options: `--port 9000`, `--data D:\Papers` (where the
database and PDFs live), `--no-browser`, `--host 0.0.0.0` (reach it from other devices on your network; there
is no login, so only on networks you trust).

### With Docker

```bash
docker compose up -d
```

Then open http://localhost:8000. Your library is kept in the `papers-data` volume. See
[docker-compose.yml](docker-compose.yml) to use a folder on your computer for the library folder, or a model
running on your computer (Ollama, LM Studio). Subscriptions (Claude, ChatGPT) need their app on the same
computer, so in Docker use an API key or a local model.

### From the source

```bash
git clone https://github.com/hBouanane/papers && cd papers
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # macOS/Linux: .venv/bin/pip
.venv/Scripts/papers
```

## Choosing an AI model

Settings > AI model has one list of providers; each is set up the same way (key if it needs one, then
**List models** and pick one). Each provider keeps its own key and model, so you can switch freely.

- **Use your subscription**: Claude (Pro, Max) through [Claude Code](https://claude.com/claude-code), or
  ChatGPT (Plus, Pro) through OpenAI's [Codex CLI](https://developers.openai.com/codex/cli/reference)
  (`npm install -g @openai/codex`, then `codex login`). Both run on your computer with your own account,
  for your own use: don't host the app for others on your subscription.
- **Pay per use with an API key**: Anthropic, OpenAI, Google Gemini (has a free tier), Mistral, Groq, or
  OpenRouter (hundreds of models).
- **On this computer**: [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai). Free, and nothing
  leaves your machine.
- **Other**: any OpenAI-compatible server (vLLM, llama.cpp, a company gateway), by its address.

Small local models can't read a whole paper; *More options* can send just its beginning.
Keys are stored only in your local database and never sent back to the page.

With a subscription the app runs the official CLI on your computer (`claude -p` or `codex exec`, with no
tools), which signs in with your own account; usage counts toward your plan. The app never reads or stores
those credentials. `PAPERS_CLAUDE_BIN` and `PAPERS_CODEX_BIN` point at a specific binary if needed.

## Library folder

In Settings, choose a folder (**Choose…** opens a folder browser with your usual folders and drives) and the app keeps a copy of your
library there: one folder per goal (`Unsorted` for the rest), each paper as `Author et al. Year - Title.pdf`
with a `.md` notes file next to it (key points, explanations, quiz, `[[links]]` to related papers, so
Obsidian shows them as a graph). PDFs dropped into its `Inbox` folder are imported within about 10 seconds.

## Settings from the environment

| Variable | What it does |
| --- | --- |
| `PAPERS_DATA` | Folder for the database, PDFs and figures (same as `--data`). Default: `%APPDATA%\Papers`, `~/Library/Application Support/Papers` or `~/.local/share/papers` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | API keys, if you'd rather not type them in Settings |
| `S2_API_KEY` | A Semantic Scholar key; without one, search often falls back to arXiv because of rate limits |
| `PAPERS_MODEL` | The Claude model used by default (`claude-opus-5-5`) |
| `PAPERS_INBOX_POLL` | Seconds between Inbox checks (`0` turns it off) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): how the code is laid out, how to run it and the tests, and where to
start for common changes.

## License

[MIT](LICENSE)
