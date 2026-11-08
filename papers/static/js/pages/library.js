// The Library (home): greeting, what you're reading, recent papers as a shelf, and the list of all papers.
import { addPaperControl, api, app, bindAddPaper, bindRows, cite, empty, esc, loading, paperRow, pct, progressBar, STATUS, tableHead } from "../core.js";
import { cover, drawCovers } from "../covers.js";
import { goalNames, greeting, paperCard, plural, shorten } from "./shared.js";

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
    drawCovers(rows);
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
