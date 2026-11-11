# Changelog

What changed in each release. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- **Covers appear by themselves**: a paper whose PDF was still downloading kept its plain title cover until you
  opened the paper. Now every page swaps in the first page as soon as the PDF arrives, a cover that failed to
  draw is tried again, and a PDF is only visible to the app once it's completely saved.
- **Searches find the papers a topic starts from**: a keyword search for "attention mechanism" doesn't return
  *Attention Is All You Need*. The AI now also names the classics and a survey for your goal; each is looked up
  by its exact title (a title that doesn't exist is dropped) and put first, in roadmaps and in **Just search**.
- **Better results when Semantic Scholar is busy**: the arXiv search it falls back to now needs every word to
  match (it used to return papers matching any word), and a busy Semantic Scholar is skipped for a minute
  instead of being waited on before every query.
- **Goals has a road behind it**: once you have goals, your papers lie on a tilted floor along a dashed road with
  the three stages marked, on the right of the page. The papers hover and the road moves; both speed up while a
  search runs. The goal box is now as wide as Recall's.
- **Go to roadmap**: a goal with a roadmap has a button at the top that scrolls straight to it.
- **The Library always has something on the desk**: with nothing in progress it shows the next paper to start
  (*Up next*, with **Start reading** and **Overview first**) instead of an empty box, and when every paper is
  finished it says so and offers to find more or recall what you read.
- **A cleaner setup in the terminal**: a welcome box, each step as a bullet with its notes and results hanging
  under it, a pointer on the current choice, one blue accent, and a closing box with where everything went.
- **Setup asks two things, not three**: it no longer asks where to keep the app's data (it goes to the usual place,
  shown at the end, and Settings can move it). The question that stays is the folder you actually open: *Your
  papers as normal files*, with PDFs under their real titles and a notes file each. It's suggested first, an
  unusable folder is asked for again instead of being dropped silently, and it can't be the app's data folder.
- **No more crash on an unsupported Python**: on a pre-release Python the setup stopped halfway with a long
  traceback. Papers now notices before asking anything and starts itself again on Python 3.13 (through uv), or
  says what to do when uv isn't there. The README says how to install `uv`, and tests also run on Python 3.14.
- **A quiet terminal while reading PDFs**: the "fontTools is required…" lines and other notes from the PDF reader
  no longer fill the terminal. fontTools is now installed with the app, so those fonts are read properly.

## 0.3.0

- **A livelier roadmap, and searching is your choice**: a goal's roadmap is now a road of numbered stages with each
  paper's cover, and it arrives with a short animation. While papers are being searched for you see them being
  looked through, step by step. A new goal can be made with **Create without searching**, and a goal with no
  roadmap asks whether you want one instead of starting a search. Once you have goals, the Goals page shows your
  papers fanned out behind it, like Recall. The green marks are gone (the blue is used instead).
- **Goals says what it does**: the Goals page opens on *What do you want to understand?* with a **Find papers**
  button and a picture of what comes back (a reading roadmap in three stages), whether or not you have papers.
  The welcome page says the same: add a paper, or set a goal and the papers get found for you.
- **A welcome instead of empty pages**: with no papers yet, the Library opens on what the app is for, with a drawn
  paper being highlighted, asked about and scored, and three ways to start: **Add paper**, **Find papers for a
  goal**, or try it with a well-known paper in one click. Goals offers example goals to start from, the Map shows
  an example chain, and Recall says what it will search once there is something to search.
- **Reading roadmap for each goal**: the AI picks the best papers from a wide search and orders them in stages (the
  basics, the core, the newest work), with why each one and about how long it takes. Tick the ones you want, or keep
  them all; they're added to the goal and their PDFs download in the background. The roadmap stays on the goal's
  page with your progress (*Start here*, *Next up*). A new goal suggests one straight away.
- **First-run setup in the terminal**: an animated banner, then where to keep your library, an optional browsable
  folder, and which AI to use (key saved to the keychain, model picked from the provider's list, a quick check).
  `papers setup` runs it again; it's skipped outside a terminal, with `--data`, and with `--no-setup`.
- **Settings save as you change them**: no more Save buttons. One **Check it works** button for the AI, with its
  answer beside it, and the AI's state (ready, or what's missing) at the top.
- **What the AI can do**: *Look at figures* and *Interactive pages* are switches you can see (they were under More
  options), with Quick and Deep explained.
- **Where everything is kept**: Settings shows the data folder and what's in it (with sizes), where API keys are kept,
  and the optional library folder. **Move…** copies the data folder elsewhere and switches to it.
- **Visuals for any field**: the chat's interactive widgets are general now. Plots, drawings (shapes, arrows,
  curves that move), bars, grids and step-by-step walks, all with sliders, a play button and live numbers, so the AI
  can show a pendulum, a drug's half-life or supply and demand as easily as an attention pattern. They size to the
  panel, so the text stays readable.
- **Pointing at parts of a figure is accurate**: the AI sees the figure with a lettered grid and names cells, and it
  can only point at a figure it really looked at. Hover a number to light up its part.
- **Check what your model can do**: for OpenAI-compatible providers, Settings sends a tiny picture and a tiny tool
  request to the chosen model, shows whether it can see images and use tools (needed for Deep), and sets *Look at
  figures* to match.
- **More questions**: after a review or a graded quiz, ask for five more about other parts of the paper. Typed
  answers are graded in one request; blank answers aren't sent, and new questions are graded on their own.
- **Reader and chat polish**: the toolbar stays whole with the side panel open, icons replace text buttons such as
  Close, the marker's colours are reachable on hover and picking one turns the marker on, and the chat has a tidier
  composer and suggested first questions.
- Search results carry citation counts, used to rank suggestions.
- Open-source basics: code of conduct, security policy, issue and pull request templates, this changelog, and a
  README with screenshots.
- **Manage goals**: rename or delete a goal from its page. Deleting keeps its papers in your library.
- **Test yourself, two ways up front**: Flashcards or Written answers are two clear choices. Written answers show one
  question at a time, with progress, and you can grade what you've written so far.
- **"Understood" explained**: the paper's page says where the score comes from, with a link to test again.
- **Deep answers say they're still working** after a while, with the time so far.
- **Plots fit their curves**: when the range the AI chose is much taller than the curve, the axis is fitted to it.
- **The API key field can't be filled in by a password manager** (a saved password could replace your key).

## 0.2.0

- **Chat with the paper**: every Explain, Simplify, Translate or question is a conversation you can continue, with
  History per paper. Explain is a short lesson; answers have formulas, citations to sections and figures, charts,
  diagrams and interactive widgets.
- **Deep mode**: the AI searches the paper, reads sections, looks at figures and checks your library and notes
  before answering, and saves notes, highlights, words or papers when you ask (each with Undo).
- Right-to-left answers (Arabic and others) lay out right to left; each answer says which model wrote it.
- API keys move to the system keychain; long lists come a page at a time.

## 0.1.0

- First release on PyPI (`papers-app`) and as a Docker image (`ghcr.io/hbouanane/papers`).
- Goals with papers found for them, a reader with progress and hard words marked, key points, vocabulary, quizzes and
  spaced review, Recall, the Map of reference chains, a library folder for Obsidian, and a choice of AI providers.
