# Papers — Spec

An AI reading companion: find papers for a goal, skim them, read with an
explainer that knows the whole paper, track progress, quiz yourself, recall
where an idea came from, and follow reference chains.

## Tech stack

| Layer    | Choice                                   | Why                                   |
|----------|------------------------------------------|---------------------------------------|
| Backend  | Python 3.12 + FastAPI                    | small, typed, easy to test            |
| Storage  | SQLite (stdlib `sqlite3`) + FTS5         | zero setup; FTS5 gives full-text index |
| AI       | Anthropic SDK, `claude-opus-5-5`         | structured outputs via `messages.parse` |
| Papers   | Semantic Scholar Graph API (via `httpx`) | free search, open-access PDFs, references |
| PDF text | `pypdf`                                  | pure Python                           |
| Frontend | Vanilla HTML/CSS/JS served by FastAPI    | no build step                         |
| Tests    | `pytest` + FastAPI `TestClient`; AI and HTTP calls are faked | TDD, offline |

Config via env: `ANTHROPIC_API_KEY`, `PAPERS_DB` (default `data/papers.db`),
`PAPERS_MODEL` (default `claude-opus-5-5`).

## Data model

- **topics**: `id, goal, created_at` — what the user is working on.
- **papers**: `id, topic_id, title, authors, year, abstract, url, pdf_url,
  external_id, text, skim (JSON), status, progress, position, understanding,
  quiz (JSON), source_paper_id, updated_at`
  - `status`: `new` → `skimmed` → `reading` → `read`
  - `progress`: furthest point read, 0..1. `position`: where the user stopped, 0..1.
  - `understanding`: last quiz score, 0..1.
  - `source_paper_id`: the paper whose reference list led here (knowledge chain).
- **papers_fts** (FTS5): title, abstract, text, summary — filled when a paper is finished.

## Features & API

1. **Define a goal, find papers**
   - `POST /api/topics {goal}` → topic
   - `GET /api/topics/{id}/search` → AI turns the goal into a few queries, Semantic Scholar returns candidates
   - `POST /api/papers {topic_id, title, ..., source_paper_id?}` → saves paper, fetches PDF text when available
   - `POST /api/papers/{id}/pdf` (upload) → extract text
2. **Skim (Andrew Ng style)** — `POST /api/papers/{id}/skim` → problem, key contributions,
   method, key results, limitations, which sections to read closely, verdict. Status → `skimmed`.
3. **Explain with full context** — `POST /api/papers/{id}/explain {passage, question?}` → plain-language
   explanation using the whole paper as context.
4. **Progress tracking** — `PUT /api/papers/{id}/progress {position}` → stores position,
   raises `progress` to the max seen, status → `reading`. `GET /api/papers` lists status/progress/understanding.
5. **Finish & quiz** — `POST /api/papers/{id}/finish` → status `read`, indexes the paper, generates
   questions. `POST /api/papers/{id}/quiz/grade {answers}` → per-question feedback + score → `understanding`.
6. **Recall** — `POST /api/recall {idea}` → FTS candidates (or recent papers) are ranked by the AI;
   returns matching papers with the reason/passage.
7. **References & chains** — `GET /api/papers/{id}/references` → reference list from Semantic Scholar;
   adding one sets `source_paper_id`. `GET /api/papers/{id}/chain` → path from the root paper, plus children.

## UI

Single page: topics sidebar → paper list with status/progress bars → paper view with tabs:
Skim · Read (paper text, scroll tracked, select text → Explain) · Quiz · References.
A global "Where did I read this?" box.

## Out of scope

Accounts/multi-user, embeddings, PDF rendering (text view only).
