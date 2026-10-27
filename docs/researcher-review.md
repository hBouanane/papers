# Using Papers as a researcher: what gets in the way

I used the app the way I'd use it during a real literature review: drop in papers I already
have, triage a pile of search results, read a few properly, come back days later. Below is what
I'd stop doing after a week because it's boring, slow, or needs a mood I'm rarely in, and what
would fix it. Items marked **Built** are done in this round; the rest are ideas for later.

## 1. Getting papers in

| Friction | Why a researcher won't do it | Fix |
|---|---|---|
| Adding a paper means: open Library, click "Add paper", paste, click Add. | Papers arrive while I'm doing something else. Four steps is three too many. | **Built**: paste an arXiv/DOI/PDF link anywhere in the app (Ctrl+V outside a text box) and it's added. Drop PDFs anywhere on the window. |
| One PDF at a time. | I download ten PDFs in a session and want them all in. | **Built**: pick or drop several PDFs at once. |
| Uploading a PDF I already have creates a duplicate. | I don't remember what's in there; dedup is the app's job. | **Built**: uploads that match a paper in the library attach to it. |
| Papers added from the Library have no goal. | Filing is a chore; I won't come back to do it. | **Built**: the Add panel has a goal picker (defaults to the page's goal). |
| "Skim this paper" must be clicked on every paper, then waited for. | Triage should be ready when I arrive, not on demand. | **Built**: new papers are skimmed in the background when Claude is configured. |

## 2. Triage

| Friction | Why | Fix |
|---|---|---|
| No way to remove a paper or say "not relevant". | Search pulls in junk; a library I can't prune becomes useless. | **Built**: Archive (hidden but searchable and recoverable) and Delete. |
| The paper page doesn't show the abstract. | The abstract is the first thing I read. | **Built**: abstract on the paper page. |
| Six action buttons in a row on the paper page. | Everything shouts; the next step isn't obvious. | **Built**: one primary action, the rest in a "More" menu. |
| No citation export. | I need BibTeX the moment I write anything. | **Built**: "Copy BibTeX" per paper; download a `.bib` for a goal or the whole library. |
| Search results show no citation count or venue. | That's how I triage a results list. | Later: ask Semantic Scholar for `citationCount` and `venue`, sort by them. |

## 3. Reading

| Friction | Why | Fix |
|---|---|---|
| Nowhere to write my own notes. | Notes are half of reading. The notes file in the folder gets overwritten by the app. | **Built**: "My notes" on the paper page and in the reader, autosaved, written to the `.md` file. Edits made to that section of the file in another editor (Obsidian, VS Code) come back into the app. |
| Explanations only work on a selected passage. | Often my question is about the whole paper ("how does this differ from DDPM?"). | **Built**: ask a question with no passage. |
| I finish a paper but forget to click Finish. | The end of a paper is exactly when attention is gone. | **Built**: when the strip shows 90% read, the reader offers to mark it finished. |
| Everything needs the mouse. | Reading is a keyboard-and-scroll activity. | **Built**: `/` search, `s` skim/read, `n` notes panel, `e` explain the selection, `?` shows the keys. |
| PDF can't be zoomed beyond page width. | Figures and equations need zoom. | Later: zoom buttons that re-render at a larger scale. |
| Explanations arrive all at once after a wait. | A spinner for 10 s feels broken. | Later: stream the answer. |

## 4. Remembering

| Friction | Why | Fix |
|---|---|---|
| The quiz means typing five essay answers. | Nobody does homework after reading. | **Built**: flashcards. See the question, think, reveal the answer, rate yourself (Got it / Partly / Missed). Typed answers with AI grading stay as an option. |
| The quiz is one-shot. | Understanding fades; one test right after reading measures nothing. | **Built**: spaced review. Ratings schedule the next review (1, 3, 7, 21, 60 days); the Library shows what's due. |

## 5. Finding things again

| Friction | Why | Fix |
|---|---|---|
| Recall only searches finished papers. | Half of what I remember comes from papers I only skimmed. | **Built**: recall searches every paper (finished ones rank first), plus my notes and the explanations I asked for. |
| Recall is useless without an API key. | It shows an error instead of results. | **Built**: without Claude it falls back to keyword matches. |

## Later

- A weekly digest of new papers citing what I've read (Semantic Scholar `citations`).
- Highlights drawn on the PDF itself, kept with the paper.
- A "compare these papers" view that lines up problem / method / results from several skims.
- Reading-time goals per week instead of per paper.
