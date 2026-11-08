import { cover, drawCovers } from "./covers.js";
import { api, app, bindAddPaper, bindRows, busy, setBar, cite, empty, esc, loading, paperRow, pct, progressBar, statusTag, STATUS, tableHead, addPaperControl, toast } from "./core.js";

const goalNames = (goals) => Object.fromEntries(goals.map((g) => [g.id, g.goal]));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shorten = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

// A paper as its first page (with a sheet tilted behind it), its title and how far you've read.
// Hovering lifts the page, fans the sheet and turns "x% read" into "Continue →".
const paperCard = (p, note = "") => `<a class="shelf-card" href="#/papers/${p.id}">
    <span class="shelf-stage" aria-hidden="true">${cover(p, "small")}</span>
    <span class="shelf-info">
      <span class="shelf-title paper-name"><span class="ul">${esc(p.title)}</span></span>
      ${note ? `<span class="shelf-note">${note}</span>` : ""}
      <span class="shelf-foot">${progressBar(p)}<span class="foot-swap"><span class="foot-pct num">${p.status === "read" ? "Read" : `${pct(p.progress)} read`}</span>
        <span class="foot-go" aria-hidden="true">${p.status === "new" ? "Open" : "Continue"} <span class="arrow">→</span></span></span></span>
    </span>
  </a>`;

// Up to three covers fanned out like cards in a hand; they spread a little more on hover.
const coverFan = (papers) => `<span class="cover-fan" aria-hidden="true">${papers.length
  ? papers.slice(0, 3).map((p) => cover(p, "small")).join("") : `<span class="fan-empty">No papers yet</span>`}</span>`;

// "Good evening, Ada", or just "Good evening" until a name is set in Settings.
function greeting(name) {
  const h = new Date().getHours();
  const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${esc(name)}` : ""}`;
}

// ---------- Library ----------
export async function libraryPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [papers, goals, settings, due] = await Promise.all([api("/papers"), api("/topics"), api("/settings"), api("/reviews/due")]);
  if (stale()) return;
  const names = goalNames(goals);
  const folderTip = settings.library_dir ? "" : `<div class="sheet desk-box">
    <h2>Library folder</h2><p class="hint">Keep your PDFs and notes in a folder on your computer too.</p>
    <a class="button quiet small desk-link" href="#/settings">Choose a folder</a></div>`;
  const count = (s) => papers.filter((p) => p.status === s).length;

  if (!papers.length) {
    app.innerHTML = `<div class="container page">
      <h1>Library</h1>
      ${empty("Nothing here yet. Tell us what you're working on and we'll find papers for it, or add one you already have from a link or PDF.",
        `<div class="empty-actions"><a class="button" href="#/goals">Set a goal</a>${addPaperControl()}</div>`)}</div>`;
    bindAddPaper();
    return;
  }

  // The reading desk: the paper you opened last, big, with the rest you're reading as covers beside
  // what's due and your goals. Everything else is in the list below. Each thing always has the same place.
  const reading = papers.filter((p) => p.status === "reading"); // most recently opened first
  const [current, ...others] = reading;
  const goalOf = (p) => (names[p.topic_id] ? `<span class="card-goal">${esc(names[p.topic_id])}</span>` : "");
  const continueCard = (p) => `<div class="continue sheet">
      <a class="cover-link" href="#/papers/${p.id}/read" tabindex="-1" aria-hidden="true">${cover(p, "large")}</a>
      <div class="continue-text">
        ${goalOf(p)}
        <a class="continue-title paper-name" href="#/papers/${p.id}"><span class="ul">${esc(p.title)}</span></a>
        <span class="card-cite">${cite(p)}</span>
        ${p.resume_text ? `<span class="card-quote">“${esc(p.resume_text)}”</span>` : ""}
        <span class="card-foot">${progressBar(p)}<span class="num">${pct(p.progress)} read</span></span>
        <a class="button continue-go" href="#/papers/${p.id}/read">Continue reading <span class="arrow" aria-hidden="true">→</span></a>
      </div>
    </div>`;
  const shelfItem = (p) => paperCard(p);
  const goalLine = (g) => {
    const mine = papers.filter((p) => p.topic_id === g.id);
    const done = mine.filter((p) => p.status === "read").length;
    return `<a class="desk-item" href="#/goals/${g.id}"><span class="desk-item-title">${esc(g.goal)}</span>
      <span class="faint num">${done}/${mine.length}</span></a>`;
  };
  const dueLine = due.length ? ` ${due.length === 1 ? "One paper is" : `${due.length} papers are`} due for review.` : "";
  const where = current
    ? `You're ${pct(current.progress)} through <span class="lede-paper">${esc(shorten(current.title, 70))}</span>.${dueLine}`
    : `${plural(papers.length, "paper")} in your library, ${count("read")} finished.${dueLine}`;
  app.innerHTML = `<div class="container page">
    <div class="page-head page-head-split library-head">
      <div><h1 class="greeting">${greeting(settings.name)}</h1>
      <p class="lede">${where}</p></div>
      ${addPaperControl("", goals)}
    </div>
    <div class="desk">
      <h2 class="desk-heading">${current ? "Continue reading" : "Reading now"}</h2>
      <section class="desk-main">
        ${current ? continueCard(current) : `<div class="desk-empty">Nothing in progress. Pick a paper from the list below, or add one.</div>`}
        ${others.length ? `<h2 class="shelf-heading">Also reading</h2>
          <div class="shelf">${others.slice(0, 4).map(shelfItem).join("")}</div>
          ${others.length > 4 ? `<button class="button quiet small" id="all-reading">All ${reading.length} in progress</button>` : ""}` : ""}
      </section>
      <aside class="desk-side">
        <div class="sheet desk-box">
          <h2>Due for review</h2>
          ${due.length ? due.map((d) => `<a class="desk-item" href="#/papers/${d.id}/quiz"><span class="desk-item-title paper-name">${esc(d.title)}</span>
            <span class="faint num">${d.questions} cards</span></a>`).join("")
            : `<p class="hint">Nothing today. Finished papers come back here for a short review.</p>`}
        </div>
        <div class="sheet desk-box">
          <h2>Goals</h2>
          ${goals.length ? goals.map(goalLine).join("") : `<p class="hint">Group papers around what you're working on.</p>`}
          <a class="button quiet small desk-link" href="#/goals">${goals.length ? "All goals" : "Set a goal"}</a>
        </div>
        ${folderTip}
      </aside>
    </div>
    <section class="section">
      <div class="section-bar">
        <h2>All papers</h2>
        <input type="search" id="q" class="search" placeholder="Search titles, authors and full text" aria-label="Search your papers">
        <div class="segmented" role="group" aria-label="Filter by status">
          ${["all", "new", "skimmed", "reading", "read"].map((s) =>
            `<button class="${s === "all" ? "active" : ""}" data-filter="${s}">${s === "all" ? "All" : STATUS[s]}
              <span class="num">${s === "all" ? papers.length : count(s)}</span></button>`).join("")}
          <button data-filter="archived">Archived</button>
        </div>
        <a class="button quiet" href="/api/bibtex" download>Export BibTeX</a>
      </div>
      <div class="sheet table">${tableHead}<div id="rows"></div></div>
    </section></div>`;

  bindAddPaper();
  drawCovers(app.querySelector(".desk"));
  const rows = app.querySelector("#rows");
  // Archiving or deleting from the list refreshes the counts.
  bindRows(rows, () => window.dispatchEvent(new HashChangeEvent("hashchange")));
  let filter = "all";
  let hits = null; // search results, or null when the search box is empty
  let archived = []; // loaded when the Archived filter is opened
  // Switching filters or searching never makes the list shorter than it has been on this visit, so the
  // page doesn't shrink and jump up under your pointer (an empty filter just leaves room below).
  const show = () => {
    rows.style.minHeight = `${Math.max(rows.offsetHeight, parseFloat(rows.style.minHeight) || 0)}px`;
    const pool = hits ?? (filter === "archived" ? archived : papers).map((paper) => ({ paper, snippet: "" }));
    const list = pool.filter(({ paper }) => filter === "all" || paper.status === filter
      || (filter === "archived" && paper.archived));
    rows.innerHTML = list.map(({ paper, snippet }) => paperRow(paper, names, snippet)).join("")
      || `<p class="faint pad">${hits ? "No papers match that search."
        : filter === "archived" ? "Nothing archived. Archive papers that turn out not to be relevant from their More menu."
        : "No papers with this status."}</p>`;
  };
  show();
  app.querySelector("#all-reading")?.addEventListener("click", () => {
    app.querySelector('[data-filter="reading"]').click();
    app.querySelector("#rows").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  app.querySelector(".segmented").onclick = async (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    app.querySelectorAll(".segmented button").forEach((x) => x.classList.toggle("active", x === b));
    filter = b.dataset.filter;
    if (filter === "archived") archived = await api("/papers?archived=1");
    show();
  };
  let timer;
  app.querySelector("#q").oninput = (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    timer = setTimeout(async () => {
      hits = q ? await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []) : null;
      if (e.target.value.trim() === q) show();
    }, 200);
  };
}

// ---------- Goals ----------
export async function goalsPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [goals, papers] = await Promise.all([api("/topics"), api("/papers")]);
  if (stale()) return;
  const card = (g) => {
    const ps = papers.filter((p) => p.topic_id === g.id);
    const read = ps.filter((p) => p.status === "read").length;
    const share = ps.length ? read / ps.length : 0;
    return `<a class="goal-card sheet" href="#/goals/${g.id}">
      ${coverFan([...ps].sort((a, b) => (b.status === "reading") - (a.status === "reading")))}
      <span class="goal-card-text">
        <span class="goal-card-title">${esc(g.goal)}</span>
        <span class="goal-card-count">${plural(ps.length, "paper")}, ${read} finished</span>
        <span class="goal-card-foot"><span class="bar"><span style="width:${Math.round(share * 100)}%"></span></span>
          <span class="goal-card-go">Open <span class="arrow" aria-hidden="true">→</span></span></span>
      </span></a>`;
  };
  app.innerHTML = `<div class="container page">
    <div class="page-head">
      <h1 class="page-title">Goals</h1>
      <p class="lede">What you're trying to understand, with the papers that help. Describe a new one and papers get found for it.</p>
    </div>
    ${goals.length ? `<div class="goal-cards">${goals.map(card).join("")}</div>` : ""}
    <form class="sheet form new-goal" id="goal-form">
      <label for="goal">${goals.length ? "A new goal" : "What are you working on?"}</label>
      <textarea id="goal" rows="3" required placeholder="I'm building a retrieval system and need to understand how dense retrievers are trained and evaluated"></textarea>
      <div class="form-foot"><button class="button">Create goal</button></div>
    </form>
    ${(() => {
      const loose = papers.filter((p) => !p.topic_id);
      return loose.length ? `<section class="page-section">
        <h2>Not in a goal yet</h2>
        <p class="hint">Open one and choose its goal under More, Edit details, so it joins the others it belongs with.</p>
        <div class="shelf goal-shelf">${loose.slice(0, 10).map((p) => paperCard(p)).join("")}</div></section>` : "";
    })()}
  </div>`;
  drawCovers(app);
  app.querySelector("#goal-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Creating…", async () => {
      const g = await api("/topics", { method: "POST", json: { goal: app.querySelector("#goal").value.trim() } });
      location.hash = `#/goals/${g.id}`;
    });
  };
}

export async function goalPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [goals, papers, all] = await Promise.all([api("/topics"), api(`/papers?topic_id=${id}`), api("/papers")]);
  if (stale()) return;
  const goal = goals.find((g) => g.id === id);
  if (!goal) throw new Error("This goal doesn't exist. It may have been removed.");
  setBar({ back: { href: "#/goals", label: "Goals" }, title: goal.goal });

  const mine = (list) => list.length ? tableHead + list.map((p) => paperRow(p)).join("")
    : `<p class="faint pad">No papers yet. Find some below.</p>`;
  const shelf = (list) => list.length ? `<div class="shelf goal-shelf">${list.map((p) => paperCard(p)).join("")}</div>`
    : `<div class="desk-empty">No papers yet. Search below, or add one.</div>`;
  const read = papers.filter((p) => p.status === "read").length;
  // The goal at a glance: one line from each paper's key points.
  const says = (list) => {
    const withLine = list.filter((p) => p.tldr || p.key_idea);
    return withLine.length ? `<section class="page-section"><h2>What these papers say</h2>
      <p class="hint">One line from each paper's key points.</p>
      <div class="sheet says">${withLine.map((p) => `<a class="say" href="#/papers/${p.id}">
        <span aria-hidden="true">${cover(p, "small")}</span>
        <span class="say-text"><span class="say-title">${esc(p.title)}</span><p class="say-line">${esc(p.tldr || p.key_idea)}</p></span></a>`).join("")}</div></section>` : "";
  };

  app.innerHTML = `<div class="container page">
    <div class="page-head page-head-split">
      <div><h1 class="page-title goal-title">${esc(goal.goal)}</h1>
      <p class="lede">${plural(papers.length, "paper")}, ${read} finished.</p></div>
      <span class="bar-actions"><a class="button quiet" href="/api/bibtex?topic_id=${id}" download>Export BibTeX</a>${addPaperControl(id)}</span>
    </div>
    <section>
      <div id="shelf">${shelf(papers)}</div>
      <details class="as-list"><summary>Show as a list (archive, delete)</summary>
        <div class="sheet table" id="mine">${mine(papers)}</div></details>
    </section>
    ${says(papers)}
    <section class="section">
      <div class="section-bar">
        <h2>Find more</h2>
        <button class="button" id="find">Search papers</button>
      </div>
      <div id="suggestions"><p class="faint">Searches Semantic Scholar and arXiv using this goal.</p></div>
    </section></div>`;

  bindAddPaper();
  drawCovers(app);
  bindRows(app.querySelector("#mine"), () => window.dispatchEvent(new HashChangeEvent("hashchange")));
  const known = new Set(all.map((p) => p.external_id).filter(Boolean));
  app.querySelector("#find").onclick = (e) => busy(e.currentTarget, "Searching…", async () => {
    const box = app.querySelector("#suggestions");
    box.innerHTML = loading("Searching");
    let found;
    try { found = await api(`/topics/${id}/search`); }
    catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    box.innerHTML = found.length ? `<div class="sheet list">${found.map((p, i) => `
      <div class="result">
        <div class="result-body">
          <h3 class="paper-name">${esc(p.title)}</h3>
          <p class="result-cite">${cite(p)}${p.pdf_url ? `<span class="has-pdf">Full text</span>` : ""}</p>
          ${p.abstract ? `<details><summary>Abstract</summary><p>${esc(p.abstract)}</p></details>` : ""}
        </div>
        ${known.has(p.external_id) ? `<span class="in-library">In library</span>`
          : `<button class="button secondary" data-add="${i}">Add</button>`}
      </div>`).join("")}</div>` : `<p class="faint">No results. Try rewording the goal.</p>`;
    box.onclick = (ev) => {
      const b = ev.target.closest("[data-add]");
      if (b) busy(b, "Adding…", async () => {
        await api("/papers", { method: "POST", json: { ...found[b.dataset.add], topic_id: id } });
        known.add(found[b.dataset.add].external_id);
        b.outerHTML = `<span class="in-library">In library</span>`;
        const list = await api(`/papers?topic_id=${id}`);
        app.querySelector("#mine").innerHTML = mine(list);
        app.querySelector("#shelf").innerHTML = shelf(list);
        drawCovers(app.querySelector("#shelf"));
      });
    };
  });
}

// ---------- Recall ----------
// Your papers, big, behind Recall (since that's what it searches): three first pages fanned out like the
// Goals cards. They drift slowly; while a search runs they spread out and glow.
function recallBackdrop(papers) {
  const order = [...papers].sort((a, b) => (b.status === "reading") - (a.status === "reading") || b.has_pdf - a.has_pdf);
  return order.length ? `<div class="recall-backdrop" id="backdrop" aria-hidden="true"><span class="recall-hero">${coverFan(order)}</span></div>` : "";
}

export async function recallPage() {
  app.innerHTML = `<div class="container page narrow recall-page">
    <div class="page-head">
      <h1 class="page-title">Where did I read that?</h1>
      <p class="lede">Describe the idea in your own words. Searches every paper, your notes and the explanations you asked for; finished papers come first.</p>
    </div>
    <form id="recall" class="sheet form">
      <label for="idea" class="visually-hidden">The idea</label>
      <textarea id="idea" rows="3" required placeholder="Adding noise step by step, then learning to undo it"></textarea>
      <div class="form-foot"><button class="button">Search my papers</button></div>
    </form>
    <div id="results"></div>
    <div id="recall-extras" class="recall-extras"></div></div>`;
  const input = app.querySelector("#idea");
  api("/papers").then((papers) => {
    if (!app.querySelector(".recall-page")) return; // left the page meanwhile
    app.insertAdjacentHTML("afterbegin", recallBackdrop(papers));
    drawCovers(app.querySelector("#backdrop"));
    // Ideas from your own papers to try, and the papers searched first (the ones you finished).
    const ideas = papers.filter((p) => p.key_idea && p.status !== "new").slice(0, 5).map((p) => shorten(p.key_idea, 90));
    const finished = papers.filter((p) => p.status === "read");
    app.querySelector("#recall-extras").innerHTML = `
      ${ideas.length ? `<section><h2>Try an idea from your papers</h2>
        <div class="try-ideas">${ideas.map((i) => `<button type="button" class="try-idea">${esc(i)}</button>`).join("")}</div></section>` : ""}
      ${finished.length ? `<section class="page-section"><h2>Searched first</h2>
        <p class="hint">The papers you've finished; then everything else, your notes and the explanations you asked for.</p>
        <div class="shelf goal-shelf">${finished.slice(0, 8).map((p) => paperCard(p)).join("")}</div></section>` : ""}`;
    drawCovers(app.querySelector("#recall-extras"));
    app.querySelector("#recall-extras").onclick = (e) => {
      const idea = e.target.closest(".try-idea");
      if (!idea) return;
      input.value = idea.textContent;
      app.querySelector("#recall").requestSubmit();
    };
  }).catch(() => {});
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); app.querySelector("#recall").requestSubmit(); } };
  app.querySelector("#recall").onsubmit = (e) => {
    e.preventDefault();
    const box = app.querySelector("#results");
    busy(e.submitter, "Searching…", async () => {
      box.innerHTML = loading("Looking through your papers");
      app.querySelector("#backdrop")?.classList.add("searching");
      try {
        const found = await api("/recall", { method: "POST", json: { idea: input.value.trim() } });
        box.innerHTML = found.length ? `<div class="recall-results">${found.map((m) => `
          <a class="match match-card sheet" href="#/papers/${m.paper.id}">
            <span class="match-cover" aria-hidden="true">${cover(m.paper, "small")}</span>
            <span class="match-text"><span class="paper-name">${esc(m.paper.title)}</span>
            <span class="result-cite">${cite(m.paper)}</span>
            <span class="match-reason">${esc(m.reason)}</span></span></a>`).join("")}</div>`
          : empty("Nothing in your library matches that. Try other words for the same idea.");
        drawCovers(box);
      } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      finally { app.querySelector("#backdrop")?.classList.remove("searching"); }
    });
  };
}

// ---------- Map ----------
// Behind the Map: your papers spread out like a map and joined by curved lines, a reference chain if you
// have one. Dashes flow along the lines from paper to paper, and a light spreads outward from the first.
const MAP_SLOTS = [{ x: 46, y: 52, d: 0 }, { x: 64, y: 24, d: 1 }, { x: 64, y: 78, d: 1 },
  { x: 84, y: 14, d: 2 }, { x: 88, y: 50, d: 2 }, { x: 82, y: 86, d: 2 }];
const MAP_EDGES = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]];

function mapBackdrop(papers, children, trees) {
  // A real chain first (breadth-first from a root), then other papers to fill the map, real pages first.
  const picked = [];
  const queue = [...trees];
  while (queue.length && picked.length < MAP_SLOTS.length) {
    const p = queue.shift();
    if (!picked.includes(p)) { picked.push(p); queue.push(...(children[p.id] || [])); }
  }
  [...papers].sort((a, b) => b.has_pdf - a.has_pdf).forEach((p) => {
    if (picked.length < MAP_SLOTS.length && !picked.includes(p)) picked.push(p);
  });
  if (picked.length < 2) return "";
  const slots = MAP_SLOTS.slice(0, picked.length);
  const curve = ([a, b]) => {
    const s = slots[a], t = slots[b], mid = (s.x + t.x) / 2;
    return `<path d="M${s.x} ${s.y} C${mid} ${s.y} ${mid} ${t.y} ${t.x} ${t.y}" style="--d:${s.d}"/>`;
  };
  return `<div class="map-backdrop" aria-hidden="true">
    <svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${MAP_EDGES.filter(([a, b]) => a < slots.length && b < slots.length).map(curve).join("")}</svg>
    ${picked.map((p, i) => `<span class="mb-node" style="--x:${slots[i].x}%;--y:${slots[i].y}%;--d:${slots[i].d};--i:${i}">${cover(p, "small")}</span>`).join("")}
  </div>`;
}

export async function mapPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const papers = await api("/papers");
  if (stale()) return;
  const byId = Object.fromEntries(papers.map((p) => [p.id, p]));
  const children = {};
  papers.forEach((p) => { if (byId[p.source_paper_id]) (children[p.source_paper_id] ||= []).push(p); });
  const roots = papers.filter((p) => !byId[p.source_paper_id]);
  const trees = roots.filter((p) => children[p.id]);
  const loose = roots.filter((p) => !children[p.id]);

  const node = (p) => `<li>
    <a class="node" href="#/papers/${p.id}"><span class="paper-name">${esc(p.title)}</span>${statusTag(p)}</a>
    ${children[p.id] ? `<ul>${children[p.id].map(node).join("")}</ul>` : ""}</li>`;

  app.innerHTML = `<div class="container page map-page">
    <div class="map-hero">
      ${mapBackdrop(papers, children, trees)}
      <div class="page-head map-hero-text">
        <h1 class="page-title">Map</h1>
        <p class="lede">Which paper led you to which. Open a paper's references and pick one to grow a chain.</p>
      </div>
    </div>
    ${trees.length ? trees.map((t) => `<div class="sheet tree-sheet"><ul class="tree">${node(t)}</ul></div>`).join("")
      : empty("No chains yet. They appear when you follow a reference from one paper to another.")}
    ${loose.length ? `<section class="section"><h2>Not linked to other papers</h2>
      <div class="sheet list">${loose.map((p) => `<a class="loose" href="#/papers/${p.id}">
        <span class="paper-name">${esc(p.title)}</span>${statusTag(p)}</a>`).join("")}</div></section>` : ""}
  </div>`;
  drawCovers(app.querySelector(".map-backdrop") || app);
}

// ---------- Settings ----------
// ---------- Settings: AI providers ----------
const AI_GROUPS = [["subscription", "Use your subscription"], ["key", "Pay per use with an API key"],
  ["local", "On this computer (free, private)"], ["other", "Other"]];
const KEY_PAGES = {
  anthropic: "console.anthropic.com", openai: "platform.openai.com/api-keys", gemini: "aistudio.google.com/apikey",
  mistral: "console.mistral.ai", groq: "console.groq.com/keys", openrouter: "openrouter.ai/keys",
};
// What each provider needs, in a sentence or two.
function aboutProvider(p, s) {
  const link = (host) => `<a href="https://${host}" target="_blank" rel="noopener">${host}</a>`;
  if (p.id === "claude-plan") return `Runs Claude Code on this computer, signed in with your Claude account; usage counts toward your plan.
    ${s.claude_binary ? `Found it at <code>${esc(s.claude_binary)}</code>.` : `Install it from ${link("claude.com/claude-code")}.`}
    First time: in a terminal run <code>claude</code>, type <code>/login</code> and sign in. For your own use only.`;
  if (p.id === "chatgpt-plan") return `Runs OpenAI's Codex on this computer, signed in with your ChatGPT account; usage counts toward your plan.
    ${s.codex_binary ? `Found it at <code>${esc(s.codex_binary)}</code>.` : `Install it with <code>npm install -g @openai/codex</code>.`}
    First time: in a terminal run <code>codex login</code>. Answers arrive all at once rather than word by word. For your own use only.`;
  if (p.group === "key") return `Paid per use. Get a key at ${link(KEY_PAGES[p.id])}${p.id === "gemini" ? " (it has a free tier)" : ""}, paste it below,
    then List models and pick one.`;
  if (p.group === "local") return `Free and private: the model runs on this computer and nothing leaves it. Install
    ${p.id === "ollama" ? link("ollama.com") : link("lmstudio.ai")}, download a model in it and keep it running, then List models.`;
  return "Any server that speaks the OpenAI chat API (vLLM, llama.cpp, a company gateway). Set its address under More options.";
}

export async function settingsPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const s = await api("/settings");
  if (stale()) return;
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head"><h1 class="page-title">Settings</h1></div>
    <form class="sheet form" id="name-form">
      <h2>Your name</h2>
      <p class="hint">The Library greets you with it. Leave it empty for just "Good morning".</p>
      <label for="name">Name</label>
      <div class="lang-row"><input id="name" value="${esc(s.name)}" autocomplete="given-name" maxlength="60">
        <button class="button">Save</button></div>
    </form>
    <form class="sheet form" id="lang-form">
      <h2>Your language</h2>
      <p class="hint">If English isn't your first language, say which one is. Translate (when you select text in a paper)
        uses it, and new vocabulary lists include a translation for each word.</p>
      <label for="lang">First language</label>
      <div class="lang-row"><input id="lang" value="${esc(s.language)}" placeholder="e.g. French, Arabic, Spanish" list="languages">
        <button class="button">Save</button></div>
      <datalist id="languages">${["Arabic", "French", "Spanish", "Portuguese", "German", "Italian", "Turkish", "Persian",
        "Chinese", "Japanese", "Korean", "Russian", "Hindi", "Indonesian", "Vietnamese"].map((l) => `<option value="${l}">`).join("")}</datalist>
    </form>
    <form class="sheet form" id="ai-form">
      <h2>AI model</h2>
      <p class="hint">Key points, explanations, vocabulary, questions and recall are written by an AI model. Use any provider.</p>
      <label for="ai-provider">Provider</label>
      <select id="ai-provider">${AI_GROUPS.map(([group, label]) => `<optgroup label="${label}">${s.providers.filter((p) => p.group === group)
        .map((p) => `<option value="${p.id}" ${p.id === s.ai_provider ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`).join("")}</select>
      <p class="hint" id="ai-about"></p>
      <div class="ai-field" id="ai-key-field">
        <label for="ai-key">API key</label>
        <input id="ai-key" type="password" autocomplete="off">
        <p class="hint">Kept on this computer only.</p>
      </div>
      <label for="ai-model">Model</label>
      <div class="model-row"><input id="ai-model" list="ai-models" value="${esc(s.ai_model)}">
        <button type="button" class="button secondary small" id="list-models">List models</button></div>
      <datalist id="ai-models"></datalist>
      <details class="advanced"><summary>More options</summary>
        <div class="ai-field" id="ai-base-field">
          <label for="ai-base">Server address</label>
          <input id="ai-base" value="${esc(s.ai_base_url)}" placeholder="https://…/v1">
          <p class="hint">Filled in for the provider you picked. Change it only for another server or port.</p>
        </div>
        <label for="ai-context">How much of a paper to send</label>
        <select id="ai-context">
          <option value="full" ${s.ai_context === "full" ? "selected" : ""}>The whole paper (large models)</option>
          <option value="32k" ${s.ai_context === "32k" ? "selected" : ""}>About 32k tokens (most local models)</option>
          <option value="8k" ${s.ai_context === "8k" ? "selected" : ""}>About 8k tokens (small local models)</option>
        </select>
        <p class="hint">Models with a small memory can't read a whole paper at once; they get its beginning.</p>
      </details>
      <div class="form-foot ai-actions"><button type="button" class="button secondary" id="ai-test">Test connection</button>
        <button class="button" id="ai-save">Save</button></div>
      <p id="ai-status" class="hint" role="status"></p>
    </form>
    <form class="sheet form" id="folder-form">
      <h2>Library folder</h2>
      <p class="hint">Keep a copy of your library in a folder on this computer. Each goal gets a folder, each paper
        its PDF plus a Markdown notes file with key points, explanations, quiz and links to related papers.
        The notes open in any Markdown app, and in Obsidian the links between papers show up as a graph.</p>
      <label for="folder">Folder</label>
      <input id="folder" value="${esc(s.library_dir)}" placeholder="${esc(s.suggested)}">
      <p class="hint">A full path. The folder is created if it doesn't exist. Leave it empty to stop keeping a copy.</p>
      <div class="form-foot"><button class="button">Save</button></div>
      <div id="folder-status"></div>
    </form></div>`;
  const status = (folder) => folder ? `<div class="folder-preview">
      <p>Your library is kept in <strong>${esc(folder)}</strong>. Drop PDFs into the Inbox folder and they're added within a few seconds.</p>
      <pre>${esc(folder)}
  Inbox/            drop PDFs here
  Unsorted/         papers without a goal
  &lt;goal&gt;/
    Vaswani et al. 2017 - Attention Is All You Need.pdf
    Vaswani et al. 2017 - Attention Is All You Need.md</pre></div>` : "";
  app.querySelector("#folder-status").innerHTML = status(s.library_dir);
  app.querySelector("#name-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const saved = await api("/settings", { method: "PUT", json: { name: app.querySelector("#name").value } });
      toast(saved.name ? `Saved. Hello, ${saved.name}.` : "Name removed.");
    });
  };
  app.querySelector("#lang-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const saved = await api("/settings", { method: "PUT", json: { language: app.querySelector("#lang").value } });
      toast(saved.language ? `Translations will be in ${saved.language}.` : "Translations turned off.");
    });
  };
  // ----- AI model: one list of providers, each set up the same way -----
  const q = (sel) => app.querySelector(sel);
  const aiStatus = q("#ai-status");
  const say = (text, ok = true) => { aiStatus.className = ok ? "hint" : "error"; aiStatus.textContent = text; };
  let ai = s;
  const showProvider = () => {
    const p = ai.providers.find((x) => x.id === ai.ai_provider);
    const subscription = p.group === "subscription";
    q("#ai-about").innerHTML = aboutProvider(p, ai);
    q("#ai-key-field").hidden = !p.key;
    q("#ai-key").value = "";
    q("#ai-key").placeholder = ai.ai_key_set ? "A key is saved. Type to replace it." : "Paste your key";
    q("#ai-model").value = ai.ai_model;
    q("#ai-model").placeholder = subscription ? "Leave empty for the default model" : "Pick from the list or type its name";
    q("#list-models").hidden = subscription;
    q("#ai-models").innerHTML = "";
    q("#ai-base-field").hidden = p.kind !== "openai";
    q("#ai-base").value = ai.ai_base_url;
  };
  showProvider();
  // Picking a provider switches to it at once; its own key and model come back as you left them.
  q("#ai-provider").onchange = async (e) => {
    ai = await api("/settings", { method: "PUT", json: { ai_provider: e.target.value } });
    showProvider();
    say(ai.ai_ready ? "Switched. Use Test connection to check it works." : "Now finish setting it up below, then Save.");
  };
  const saveAi = async () => {
    const p = ai.providers.find((x) => x.id === ai.ai_provider);
    const json = { ai_model: q("#ai-model").value, ai_context: q("#ai-context").value };
    if (p.kind === "openai") json.ai_base_url = q("#ai-base").value;
    if (q("#ai-key").value) json.ai_api_key = q("#ai-key").value;
    ai = await api("/settings", { method: "PUT", json });
    return ai;
  };
  q("#ai-form").onsubmit = (e) => {
    e.preventDefault();
    busy(q("#ai-save"), "Saving…", async () => {
      await saveAi();
      showProvider();
      say(ai.ai_ready ? "Saved. Use Test connection to check it works."
        : ai.providers.find((x) => x.id === ai.ai_provider).group === "subscription" ? "Saved, but its app isn't installed yet (see above)."
        : !ai.ai_model ? "Saved. Now choose a model." : "Saved, but an API key is still needed.");
    });
  };
  // Ask the provider which models it has, so you pick a real name instead of guessing one.
  q("#list-models").onclick = (e) => busy(e.currentTarget, "Asking…", async () => {
    await saveAi();
    try {
      const { models } = await api("/ai/models");
      q("#ai-models").innerHTML = models.map((m) => `<option value="${esc(m)}">`).join("");
      say(models.length ? `${models.length} models available. Click the Model box to pick one, then Save.` : "The provider listed no models.");
      q("#ai-model").focus();
    } catch (err) { say(err.message, false); }
  });
  q("#ai-test").onclick = (e) => busy(e.currentTarget, "Asking the model…", async () => {
    await saveAi();
    const r = await api("/ai/test", { method: "POST" });
    say(r.message, r.ok);
  });
  app.querySelector("#folder-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const saved = await api("/settings", { method: "PUT", json: { library_dir: app.querySelector("#folder").value } });
      app.querySelector("#folder-status").innerHTML = status(saved.library_dir);
      toast(saved.library_dir ? "Library folder saved and filled." : "No longer keeping a copy in a folder.");
    });
  };
}
