# Changelog

What changed in each release. Versions follow [semantic versioning](https://semver.org).

## 0.5.0

- **A new overview: the paper in two minutes**: instead of lists (reading plan, questions, contributions), a paper's
  overview is now what a great teacher says first: two sentences on what it does and why it matters, the problem
  with an everyday example, the one idea that makes it work drawn as steps, 3 to 5 key ideas, the headline numbers,
  the one figure to look at first, and what to keep in mind. Papers prepared before keep their key points until
  you Regenerate them.
- **The in-depth guide**: "Explain it in depth" writes the full lesson on a paper: the problem, the background you
  need, each part of the method with its formulas explained symbol by symbol and worked through with real numbers,
  the paper's figures with the parts marked, the experiments, and what the results do and don't show. It opens in a
  reader as a third view next to Original and Text, with Ask, Words and Notes beside it: switch between the paper
  and the guide like between the PDF and the text. A thin rail on the right replaces the scrollbar: it marks each
  section, shows where you are and the section's name as you move, and takes you anywhere with a click; ← → move
  between sections. Guides are kept with the paper, and any long answer in the chat can be opened there too.
- **Plain addresses**: pages have addresses like `papers.localhost:8000/papers/3/read` (no `#`, and a name of its
  own instead of "localhost"). Old bookmarks still work.
- **Papers as a desktop app, with its own icon**: `papers` now opens Papers in a window of its own instead of a
  browser tab (Edge, Chrome, Chromium, Brave or Vivaldi, on Windows, macOS and Linux; with only Firefox or Safari, a
  tab), and closing the window stops Papers; nothing is lost, everything is saved as you go. The first-run setup
  offers an icon on your desktop, and `papers shortcut` adds one any time: double-click it and Papers starts and
  opens (on Windows without a console window). `papers --browser` opens a tab that keeps running, as before.
- **The guide and the chat side by side**: the chat beside the guide reads like a second page (questions as titles,
  answers in the guide's type), with its own rail of questions and sections; hover a rail and the section names
  float out beside their marks. The newest guide always opens.
- **A guide that teaches from scratch**: the in-depth guide now starts with the paper in brief and teaches what you
  need first (the ideas the paper builds on), then the words, the key idea, each part of the method, the
  experiments and the limits, in connected paragraphs; every visual says how to read it and what to try.
- **A calmer overview**: the paper's abstract sits folded at the top, the text uses one font in a few sizes, the
  boxes respond to the pointer, and "The big picture, in one figure" picks the figure a newcomer can read, with how
  to read it. Archiving a paper no longer makes the page flash.
- **The Map's papers settle smoothly** into their corners instead of jumping up as they arrive.
- **Calmer visuals**: diagrams are drawn in the app's own font with clean shapes (no more handwriting), two things
  compared sit side by side, tables have borders, and every diagram, figure and chart fits on the screen: bar
  charts keep a modest height and never spill below their axis.

## 0.4.0

- **Explanations point at the figure**: when the passage you ask to explain refers to a figure ("shown in
  Figure 1"), the AI looks at that figure and marks the part the passage is about, right in the explanation.
- **Sharper boxes on figures**: the grid the AI points with is now like a chessboard, with names only along the
  edges and squares twice as fine, so boxes fit the part they mark much more closely. Older answers keep their boxes.
- **Comparing figures when it helps**: the AI compares figures when you ask, or when its explanation is clearer by
  showing the same thing in two figures (say, the idea you're reading about, drawn in a paper you've read); not
  otherwise.
- **Compare figures across papers, in Deep mode**: ask "compare Figure 1 with Figure 1 of <another paper>" and the AI
  looks at both side by side, then shows them next to each other with the parts that do the same job in the same
  colour. It works on figures only (not tables), asks which paper you mean when the title is unclear, and a
  comparison is shown only if the AI really looked at both figures; pairs whose boxes don't hold up are dropped.
- **Diagrams look hand-drawn**: flowcharts and the other diagrams in answers are now sketched like a whiteboard
  drawing (Excalidraw's look), with Excalidraw's handwriting for the labels. Mind maps get soft colours that
  read in both themes.
- **Works without internet**: the PDF viewer, answer formatting and formulas, diagrams, charts, widgets and the
  fonts now ship with Papers instead of loading from the internet each time. With a local model (Ollama, LM
  Studio) you can read, ask, take notes and review offline; only finding and downloading papers need a
  connection. Pages also load faster. Papers is about 8 MB bigger.
- **Uploading a paper that isn't on arXiv works again**: when its PDF had a DOI, the paper was looked up and the
  save failed on a detail that came back with it (its citation count). Now only the paper's own fields are saved.
- **Errors in plain words**: no more HTTP codes, JSON or "Request failed (500)". You're told what happened and what
  to do ("You've reached the AI's usage limit for now (it resets at 2:20am)", "The AI didn't accept the API key.
  Check it in Settings", "Papers isn't answering: check that it's still running"). The original message is under
  *Details* in the chat and in the terminal, for reporting a problem.
- **Figure quiz** (Recall): a figure from a paper you're reading or have read, and "Click the decoder". The
  right part is shown after each click, and you get a score at the end. The AI finds a figure's parts once and
  they're kept, so the next quiz on it starts at once.
- **A figure's boxes, one at a time**: when the AI boxes several parts of a figure, ‹ › walks through them, each
  highlighted with its name. Clicking a box starts a question about that part.
- **The model check-up does more and switches off what fails**: *Check this model* in Settings now also tests
  whether the model writes clean JSON (charts, formulas, widgets) and can point at the right spot on a picture.
  A model that fails gets tables and diagrams instead of charts, figures without boxes, and Quick answers instead
  of Deep for figure questions.
- **Weak models can't spoil an answer as easily**: boxes around the whole figure, the same part boxed twice, or
  more than six boxes are dropped; tool calls a model writes into its answer as text are taken out (and if
  nothing else is left, it says the model can't do Deep mode); reading times in roadmaps stay under four hours.
- **"Plot Table 2" uses the paper's numbers**: the AI is told to take a table's values from the paper, never to
  invent them.
- **Said when the paper was too long for the model**: when Settings sends only the beginning of a paper, the answer
  says so, with a link to the setting.
- **Roadmaps start with the papers a field is built on**: besides keyword searches, Papers now looks at what the
  results themselves cite, and a paper most of them reference comes first, even when no search returned it. For
  "attention" that brings *Attention Is All You Need* to the top; for causal inference, Rosenbaum and Rubin. The
  roadmap and search results mark these as *A classic* or *Cited by N of these*.
- **Searches don't come back empty when a service is busy**: Semantic Scholar is tried first, then OpenAlex, with
  arXiv only for exact titles. Calls are spaced out, results are reused for an hour, and when every service
  refuses, a card says so (with Try again) instead of showing nothing.
- **Search keys in Settings**: optional free keys for Semantic Scholar and OpenAlex make searches reliable. They're
  kept in the system keychain like the AI keys.
- **Any OpenAI-compatible server can have an API key**: choosing it now shows a key field (for DeepSeek, Together,
  xAI, a company gateway) and its server address right away, not under More options. The terminal setup asks for
  both too.
- **Diagrams have their text again**: boxes in flowcharts and other diagrams the AI drew were empty. Their labels
  were HTML, which the safety filter removed; they're now drawn as plain SVG text.
- **Questions about a figure get the figure**: asking about "Figure 1" (or pointing at it) now answers the way Deep
  mode does even when Quick is chosen, so the AI looks at the image and can put numbered boxes on its parts.
  Before, Quick mode answered from the caption only and said it couldn't point at anything.
- **A goal with no papers is one clear card**: no empty shelf, empty list and roadmap heading stacked on top of
  each other; just the card that finds papers, under the title. When a search brings nothing back, a card says
  why it may have happened and offers Try again, in place of the empty one, not under it.
- **Rename, Export BibTeX and Delete are in a More menu** on a goal's page, instead of icons always showing.
- **Fewer "nothing here" boxes**: the Library shows *Due for review* only when something is due, and the Map
  shows how to start a chain instead of a "No chains yet" box above your papers.

## 0.3.2

- **Starting is faster and never looks frozen**: a spinner shows while Papers loads and while the server starts.
  The link is printed, and the browser opened, only once the page really answers. A slow library (the Anthropic
  client) is now loaded when first used, which cuts several seconds from every start.
- **Scanned PDFs say so**: a PDF that is only pictures of pages has no text to select. The reader now tells you
  instead of leaving you to wonder why selecting does nothing.

## 0.3.1

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
