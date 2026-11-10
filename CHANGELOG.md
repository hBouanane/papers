# Changelog

What changed in each release. Versions follow [semantic versioning](https://semver.org).

## Unreleased

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
- Search results carry citation counts, used to rank suggestions.
- Open-source basics: code of conduct, security policy, issue and pull request templates, this changelog, and a
  README with screenshots.

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
