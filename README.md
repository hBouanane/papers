<h1 align="center">Papers</h1>

<p align="center"><strong>An AI reading companion for research papers.</strong><br>
Find the right papers for what you're working on, read them with an AI that knows the whole paper,
and remember what you read.</p>

<p align="center">
  <a href="https://pypi.org/project/papers-app/"><img alt="PyPI" src="https://img.shields.io/pypi/v/papers-app?color=1d3fbb"></a>
  <a href="https://pypi.org/project/papers-app/"><img alt="Python 3.11+" src="https://img.shields.io/pypi/pyversions/papers-app"></a>
  <a href="https://github.com/hBouanane/papers/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/hBouanane/papers/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/hBouanane/papers/pkgs/container/papers"><img alt="Docker image" src="https://img.shields.io/badge/docker-ghcr.io%2Fhbouanane%2Fpapers-1d3fbb?logo=docker&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/hBouanane/papers"></a>
</p>

<p align="center">
  <code>uvx papers-app</code>
</p>

![The welcome page: a paper being highlighted, asked about and scored](docs/screenshots/welcome.gif)

![The Library: the paper you're reading, the others on your desk, what's due for review, and your goals](docs/screenshots/library.png)

## About

Reading research papers is slow when you're new to a field: you don't know which papers matter, in what order to
read them, or what half the words mean. Papers is the companion for that.

- **Start from a goal.** Say what you're trying to understand. Papers searches Semantic Scholar and arXiv and the AI
  suggests a **reading roadmap**: the basics first, then the core methods, then the newest work, with why each
  paper and about how long it takes. Tick the ones you want (or keep them all) and they're added, PDFs included.
- **Read with an AI that has the whole paper.** Select a passage and press **Explain**, **Simplify** or
  **Translate**, or just ask. Answers cite the paper's sections and figures, write formulas properly, and can
  draw charts and small interactive widgets. Every question is a conversation you can come back to.
- **Remember it.** Key points for every paper, its hard words marked in the text, a quiz when you finish, spaced
  review, and **Recall**: describe an idea in your own words and find where you read it.

It runs on your computer. Your library (papers, notes, highlights, conversations) is a folder on your disk, and you
choose the AI: your Claude or ChatGPT subscription, an API key, or a model running locally with Ollama or LM Studio.

## A tour

<table>
<tr>
<td width="50%"><img src="docs/screenshots/chat-figure.png" alt="A Deep answer that points at the encoder, the decoder and where they connect in the paper's Figure 1"><br>
<b>Ask about a figure.</b> The AI looks at the figure and points at the parts it is talking about.</td>
<td width="50%"><img src="docs/screenshots/chat-widget.png" alt="An answer with a plot of the learning-rate schedule and sliders to change it"><br>
<b>Play with a formula.</b> Answers can draw plots and small widgets with sliders, for any field.</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/goal-papers.png" alt="A goal: its papers shown by their first pages, and one line from each"><br>
<b>Goals.</b> Each goal keeps its papers together, shown by their first pages, with one line on what each says.</td>
<td width="50%"><img src="docs/screenshots/recall.png" alt="Recall: search your papers by an idea in your own words"><br>
<b>Recall.</b> "Where did I read that?" Searches every paper, your notes and the explanations you asked for.</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/goal.png" alt="A goal's reading roadmap: stages of papers with why and how long each"><br>
<b>Reading roadmap.</b> For each goal, the best papers in reading order. Pick some or all; PDFs download for you,
and your progress shows as you read (<i>Start here</i>, <i>Next up</i>).</td>
<td width="50%"><img src="docs/screenshots/reader.png" alt="Reading a paper with an explanation of a formula beside it"><br>
<b>Reader.</b> Select a passage to have it explained, simplified or translated, beside the page.</td>
</tr>
<tr>
<td><img src="docs/screenshots/paper.png" alt="A paper's page: abstract, key points, figures, words, notes, references"><br>
<b>Each paper at a glance.</b> Key points, figures and tables, its vocabulary, your notes, and its references
(follow one to grow a chain on the Map).</td>
<td><img src="docs/screenshots/reader-dark.png" alt="The reader in the dark theme"><br>
<b>Light, dim or dark</b>, with the PDF pages dimmed to match.</td>
</tr>
<tr>
<td><img src="docs/screenshots/settings-features.png" alt="Settings: what the AI can do, Quick and Deep"><br>
<b>Quick or Deep.</b> Quick answers at once from the paper; Deep lets the AI search it, read sections, look at
figures and check your library first.</td>
</tr>
</table>

## Install

With Python 3.11 or newer, one command (like `npx` for Node):

```bash
uvx papers-app
```

or install it to keep it around, then start it with `papers`:

```bash
pipx install papers-app
```

The first time, a short setup in the terminal asks three things, so it's clear from the start where everything goes:

```
1/3  Your library        where the database, PDFs and figures are kept (one folder)
2/3  A folder to browse  optional: each paper's PDF and Markdown notes, for your file manager or Obsidian
3/3  The AI model        provider, key (kept in your system's keychain) and model, then a quick check
```

Then `papers` opens http://localhost:8000 in your browser. Everything can be changed later in Settings, or with
`papers setup`. Options: `--port 9000`, `--data D:\Papers` (use this data folder), `--no-browser`, `--no-setup`,
`--host 0.0.0.0` (reach it from other devices on your network; there is no login, so only on networks you trust).

### With Docker

The image is published on GitHub's registry, so one command pulls it and starts the app:

```bash
docker run -d --name papers -p 8000:8000 -v papers-data:/data ghcr.io/hbouanane/papers:latest
```

Then open http://localhost:8000 and choose the AI in Settings. What each part means:

| Part | Meaning |
| --- | --- |
| `-d --name papers` | run in the background, named `papers` (`docker stop papers` / `docker start papers`) |
| `-p 8000:8000` | the app inside listens on port 8000; this makes it http://localhost:8000 on your computer |
| `-v papers-data:/data` | your library (database, PDFs, figures) lives in `/data` inside the container; this keeps it in a Docker volume called `papers-data`, so it survives updates and restarts. Use a folder instead with `-v ~/Papers-data:/data` |
| `ghcr.io/hbouanane/papers:latest` | the image: on GitHub's registry (`ghcr.io`), from this repository, the newest release (or a version, e.g. `:0.3.0`) |

To update: `docker pull ghcr.io/hbouanane/papers:latest`, then `docker rm -f papers` and the same `docker run` again
(the volume keeps your library). From a clone you can also build it yourself with `docker compose up -d`; see
[docker-compose.yml](docker-compose.yml) to use a folder on your computer for the library folder, or a model running
on your computer (Ollama, LM Studio). Subscriptions (Claude, ChatGPT) need their app on the same computer, so in
Docker use an API key or a local model.

### From the source

```bash
git clone https://github.com/hBouanane/papers && cd papers
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"     # macOS/Linux: .venv/bin/pip
.venv/Scripts/papers
```

## Where everything is kept

Settings › *Where everything is kept* shows all of it, with sizes:

| What | Where |
| --- | --- |
| Your library: the database (papers, notes, highlights, goals, conversations), PDFs, figure images | One **data folder**, chosen at the first start. Default: `%APPDATA%\Papers`, `~/Library/Application Support/Papers` or `~/.local/share/papers`. **Move…** in Settings copies it elsewhere and switches to it (the old folder is left for you to delete) |
| API keys | Your system's keychain (Windows Credential Manager, macOS Keychain, the Secret Service on Linux); in the database only where there's none (Docker, servers). Never sent back to the page |
| Which data folder to use | A small `config.json` beside the default data folder (`PAPERS_CONFIG` to put it elsewhere) |
| A browsable copy (optional) | The **library folder**: one folder per goal, each paper as `Author et al. Year - Title.pdf` with a `.md` notes file (key points, explanations, quiz, `[[links]]` to related papers, so Obsidian shows a graph). PDFs dropped into its `Inbox` are imported within about 10 seconds |

## Choosing an AI model

Settings › AI model has one list of providers, each set up the same way: its key if it needs one, then **List
models** and pick one. Changes save as you make them, and **Check it works** sends one short question to make sure.
Each provider keeps its own key and model, so you can switch freely.

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
With a subscription the app runs the official CLI on your computer (`claude -p` or `codex exec`), which signs in
with your own account; usage counts toward your plan. The app never reads or stores those credentials.
`PAPERS_CLAUDE_BIN` and `PAPERS_CODEX_BIN` point at a specific binary if needed.

## Asking the AI

Select text in a paper and press **Explain** (a short lesson: the problem, the idea, the formula read slowly, a worked
example, why it works, where it connects in the paper), **Simplify** (the same passage in plain English) or
**Translate**. Each starts a conversation you can keep going; **History** keeps them per paper, and **Add to chat**
attaches more passages. Answers can contain formulas, clickable citations ([§3.4], [Fig. 1]), charts, diagrams, the
paper's own figures with "look here" boxes, and interactive widgets.

The chat has two modes:

| | **Quick** | **Deep** |
| --- | --- | --- |
| How it answers | One step: the whole paper (and the conversation so far) goes to the model with your question | In steps: the AI searches the paper, reads sections, looks at figures, checks your notes and library, then answers. You see each step |
| Can it act | No | When you ask: saves notes, highlights passages, adds words or a paper from the references, each with Undo |
| Speed | Fast | Slower, more thorough |
| Needs | Any model | Claude (subscription or API key) or a model with tool calling. To let it see figures, turn on *Look at figures* in Settings |

The buttons on a selection (Explain, Simplify, Translate) answer Quick; **Deeper** under an answer goes Deep.
In Settings › *What the AI can do*, *Interactive pages* lets the AI write small demos that run in a sealed frame (no
access to the app, your files or the internet).

## Settings from the environment

| Variable | What it does |
| --- | --- |
| `PAPERS_DATA` | The data folder (same as `--data`); it wins over the one chosen in the setup |
| `PAPERS_CONFIG` | Where `config.json` (which data folder to use) is kept |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | API keys, if you'd rather not type them in Settings |
| `S2_API_KEY` | A Semantic Scholar key; without one, search often falls back to arXiv because of rate limits |
| `PAPERS_MODEL` | The Claude model used by default (`claude-opus-5-5`) |
| `PAPERS_INBOX_POLL` | Seconds between Inbox checks (`0` turns it off) |

## Contributing

Contributions are welcome: bug reports, ideas and pull requests. [CONTRIBUTING.md](CONTRIBUTING.md) explains how the
code is laid out, how to run it and the tests (no keys needed: AI and network calls are faked), and where to start
for common changes. Please follow the [code of conduct](CODE_OF_CONDUCT.md). Changes are listed in
[CHANGELOG.md](CHANGELOG.md); the design is in [SPEC.md](SPEC.md) and [DESIGN.md](DESIGN.md).

Found a security problem? Please report it privately: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
