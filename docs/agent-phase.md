# The agent phase: deeper explanations, visuals, conversations

The version before this phase is tagged **`classic-v1`** (`git checkout classic-v1` to go back to it).

## What we want

Today, Explain gives one paragraph per heading ("Simpler version", "Jargon defined", ...). It's correct but thin,
and you can't continue it. The goal is an explanation like a patient expert would give: the problem first, the
idea, the formula read slowly, a worked example with real numbers, why it works, how it connects to the rest of
the paper, what happened since. Charts, diagrams or an interactive visual when they make it clearer. And then you
can keep asking.

## The design in one picture

```
 Select text ─► [Explain] [Simplify] [Translate] [Ask about this]
                    │          │          │              │
                    ▼          ▼          ▼              ▼
              one-shot answer (fast, no tools)     Chat with the passage as context
                    │                                    │
                    └── "Ask a follow-up" / "Go deeper" ─┘
                                     │
                          a Conversation (saved, titled, in History)
                          quick mode: one model call per message
                          agent mode: the model reads the paper, looks at figures,
                                      draws visuals and saves notes, step by step
```

## Your ideas, and what I'd add

**1. Chat version and agent version.** Agreed, with one change: they're two *depths* of the same chat, not two
apps. The selection buttons stay one-shot and fast. Every answer is already the start of a conversation, so
"Ask a follow-up" continues it with the same context, and "Go deeper" re-runs it in agent mode. The chat has a
switch, **Quick** / **Deep (agent)**. Deep is off for models that can't use tools well (small local models).

**2. Simplify and Explain are different jobs.**
- **Simplify**: the same meaning in plain English. Short sentences, common words, nothing added, nothing deeper.
  Hard words kept but explained in a few words. It's a rewrite, not a lesson.
- **Explain**: a lesson, as deep as the passage needs. It follows a fixed path: the problem, the idea, the
  notation read slowly, a worked example with real numbers, why it works, links to the paper (sections, figures,
  tables, which you can click), and what came after (marked as outside the paper). It ends with one question
  to check yourself. Visuals are added when they help.
- **Translate** stays as it is.

**3. Each explanation keeps its context.** Each one is a conversation: the passage stays pinned at the top as a
context chip, plus the paper, plus the figures it used. Follow-ups see all of it. History lists them per paper,
titled automatically, and you can reopen any of them.

**4. Add context by selecting.** In a conversation, selecting text in the paper offers **Add to chat**. The text
becomes a chip above the message box, like attaching a file in Claude. Figures can be added the same way, from
the Figures tab or from the PDF.

**5. Better chat UI.** It's taken from what works in Claude's chat, listed below.

## What we take from Claude's chat

| Claude does | In Papers |
| --- | --- |
| Conversations with a list and automatic titles | History per paper ("Positional encoding", "Why scale by √d"); new chat; search |
| Attachments shown as chips | Context chips: passages, figures, tables, sections |
| Shows its work while answering ("Searching…", tool steps, "Thought for 12s") | A live status line ("Reading §3.4 · Looking at Figure 1 · Drawing a chart") with a Steps list you can open; reasoning shown folded |
| Stop button while it answers | Stop, always; nothing hangs |
| Artifacts: visuals open in a side canvas | Visuals sit in the message as cards and open large in a canvas beside the chat |
| Markdown, math, tables, code rendered well | The same, plus KaTeX for formulas and clickable citations: [§3.4] or [Fig. 1] jumps to that spot in the PDF |
| Message actions: copy, retry, edit | Copy, Retry, Simpler, Deeper, Save as note, Listen |
| Suggested follow-ups | Two or three short chips after an answer ("Why sine and cosine?", "Show it for d=8") |
| Resizable, can go full screen | The panel goes from narrow to wide to focus (the chat beside a smaller paper), drag to resize; remembered |

**"Thinking", done right.** No bouncing dots. Grey placeholder lines shimmer where the answer will appear, a
status line says what's happening, and seconds show after 5 seconds. For reasoning models, "Thinking…" can be
opened to read the reasoning as it streams. After 90 seconds without a word it stops, with **Retry** and a hint
("this model is slow, try another in Settings"). An empty answer is never saved: it shows "No answer came back"
with Retry.

## Visuals: what the model can draw

The model writes visuals as fenced blocks in its answer. The page draws them; no code from the model runs.

| Block | Draws | Library |
| --- | --- | --- |
| `chart` | Bar, line or scatter plots, heatmaps (e.g. results from Table 2; the positional-encoding matrix) | Vega-Lite (BSD) |
| `diagram` | Flowcharts and architecture boxes (the Transformer encoder/decoder) | Mermaid (MIT) |
| `math` | A formula with its parts coloured and labelled, then the substituted numbers | KaTeX (MIT) |
| `figure` | The paper's own figure with "look here" boxes drawn on it | The figures you already cut out |
| `widget` | Interactive: sliders driving a plot, a rotating unit circle, a step-by-step animation, a matrix you can hover | Small built-in widgets, settings only (math.js expressions, no JavaScript from the model) |

For the positional-encoding example, that means:
- a `widget`: clock hands, one per frequency, with a slider for the position;
- a `chart`: the heatmap of PE(pos, dim);
- a `math` block: the formula with `pos`, `i` and `d_model` labelled.

**Later, as an opt-in:** fully custom interactive pages written by the model, run in a locked-down frame with no
network and no access to the app, like Claude's artifacts. That's powerful but riskier, so only once the built-in
widgets have proven themselves.

## The agent: loop and tools

**Harness** (decided earlier):
- **API keys and local models:** PydanticAI runs the loop inside the app.
- **Claude or ChatGPT subscriptions:** Claude Code or Codex runs the loop, with one local MCP server for the tools.
  It's started by the CLI, talks to the running app on localhost with a token, and is never exposed.
- **Both:** the tools are written once and used by both.

**Tools**

| Read | Act (add only, each shown with Undo) |
| --- | --- |
| `search_paper(query)` → passages with page and section | `save_note(text, quote?)` |
| `read_section("3.4")` | `save_word(term, context)` |
| `look_at_figure(n)` → the image, so the model sees it | `highlight(quote, color)` |
| `get_table(n)` → its numbers | `add_paper(reference)` (from the references, grows the Map) |
| `get_equation(near)` | |
| `search_library(idea)`, `get_notes()`, `get_vocabulary()` | |

Visuals are blocks in the answer, not tools, so every provider can produce them.

**Limits:**
- at most 8 tool steps and 2 minutes per answer;
- Stop cancels the loop;
- agent-made notes and highlights carry a small "AI" mark.

**Streaming events** replace today's text-only stream, one JSON line each:
`status`, `thinking`, `text`, `tool` (step started or done), `visual`, `action` (with an undo id), `done`, `error`.

**Context:**
- the paper sits in a cached system block, as today;
- the conversation's turns follow, and older turns are summarised when it grows long;
- context chips go in as quoted blocks.

## Data

- `conversations`: id, paper, title, created, updated, mode (quick or agent).
- `messages`: id, conversation, role, blocks (JSON: text, visual, steps, actions), status (streaming, done,
  stopped, error).
- `context_items`: id, conversation, kind (passage, figure, table, section), payload.
- Today's `explanations` become conversations of two messages, so nothing is lost and History starts full.

## Plan

Each phase is its own PR, built on the one before, and each leaves the app working.

| Phase | What you get |
| --- | --- |
| **0. Never stuck** | Fixes today's "Thinking" forever: no more empty answers saved, reasoning models streamed (with "Thinking…" you can open), Stop, a 90-second timeout with Retry, the new loading look |
| **1. Conversations** | Conversations and History per paper, follow-ups with context, "Add to chat" chips, the bigger resizable panel, message actions, suggested follow-ups |
| **2. Deep Explain and true Simplify** | The new Explain and Simplify, KaTeX math, clickable [§] and [Fig.] citations, the `chart`, `diagram`, `math` and `figure` visuals, the canvas |
| **3. Agent mode** | Deep mode: the tool loop (PydanticAI, plus Claude Code and Codex with the local MCP server), the read tools, live steps |
| **4. Actions** | Saving notes and words, highlights and adding papers from the chat, with Undo and the AI mark |
| **5. Interactive** | The built-in `widget` visuals; later, opt-in model-written pages in a locked-down frame |

## What was built (and where it differs from the plan)

All five phases are in, in this order, each tested before the next:

- **0. Never stuck:** `papers/ai/streaming.py` tells reasoning from the answer (OpenRouter `reasoning`, DeepSeek and vLLM
  `reasoning_content`, `<think>` tags, Claude Code thinking), gives up after 90 seconds of silence, and stops the
  model when you press Stop. An empty answer is an error, never saved. The loading look is `static/js/chat/answer.js`.
- **1. Conversations:** `papers/chat/` and `static/js/chat/conversation.js`. Earlier explanations were carried over
  once (empty ones left out). Search, Recall and the library folder read answers from conversations.
- **2. Deep answers:** the tutor's rules and the tasks in `papers/llm.py`; rendering in `static/js/chat/render.js`
  (Markdown, KaTeX, citations, `chart`, `diagram`, `math`, `figure`), with lenient reading of the model's JSON.
- **3. Agent mode:** instead of PydanticAI, a small tool loop over the providers the app already had
  (`papers/agent/loop.py`): no new dependency, every provider handled the same way. Claude Code gets the tools from a
  minimal MCP server (`papers/agent/mcp_server.py`, stdin/stdout only, no network). **Codex (ChatGPT subscription)
  doesn't run tools yet:** Deep mode answers without them and says so, until it can be tested.
- **4. Actions:** `save_note`, `highlight`, `save_word`, `add_paper`, each listed under the answer with Undo
  (`POST /api/messages/{id}/undo`); at most 5 per answer; AI-made notes and words carry an AI mark.
- **5. Interactive:** widgets (`plot`, `circles`, `heatmap`, `steps`) in `static/js/chat/widgets.js`, evaluated by
  math.js with its dangerous functions removed; model-written `page`s only when switched on, in a sandboxed frame
  with a Content-Security-Policy that blocks every connection.

How good an answer is depends mostly on the model: the same prompt gives a full lesson with a correct derivation,
labelled formulas and a clock widget with Claude, and a thinner one, sometimes with wrong numbers, with a small free
model.
