import { api, app, busy, empty, esc, loading, meta, paperRow, paperTableHead, pct, statusTag, STATUS } from "./core.js";

const goalNames = (goals) => Object.fromEntries(goals.map((g) => [g.id, g.goal]));

// ---------- Library ----------
export async function libraryPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [papers, goals] = await Promise.all([api("/papers"), api("/topics")]);
  if (stale()) return;
  const names = goalNames(goals);
  const count = (s) => papers.filter((p) => p.status === s).length;

  if (!papers.length) {
    app.innerHTML = `<div class="container page">
      <h1>Library</h1>
      ${empty("Your library is empty. Describe what you are working on and we will find papers for it.",
        `<a class="button" href="#/goals">Set your first goal</a>`)}</div>`;
    return;
  }

  const reading = papers.filter((p) => p.status === "reading");
  app.innerHTML = `<div class="container page">
    <div class="page-head">
      <h1>Library</h1>
      <p class="lede">${papers.length} papers · ${count("read")} read · ${reading.length} in progress</p>
    </div>
    ${reading.length ? `<section class="section">
      <h2 class="section-title">Continue reading</h2>
      <div class="resume-list">${reading.slice(0, 3).map((p) => `
        <a class="resume" href="#/papers/${p.id}/read">
          <span class="resume-title">${esc(p.title)}</span>
          <span class="resume-meta">${meta(p)}</span>
          <span class="resume-foot"><span class="progress"><span class="progress-fill" style="width:${pct(p.progress)}"></span>
            <span class="progress-mark" style="left:${pct(p.position)}"></span></span>
            <span>Stopped at ${pct(p.position)}</span></span>
        </a>`).join("")}</div></section>` : ""}
    <section class="section">
      <div class="section-bar">
        <h2 class="section-title">All papers</h2>
        <div class="filters" role="tablist">
          ${["all", "new", "skimmed", "reading", "read"].map((s) =>
            `<button class="filter${s === "all" ? " active" : ""}" data-filter="${s}">${s === "all" ? "All" : STATUS[s]}
              <span class="num">${s === "all" ? papers.length : count(s)}</span></button>`).join("")}
        </div>
      </div>
      <div class="paper-table">${paperTableHead}<div id="rows"></div></div>
    </section></div>`;

  const rows = app.querySelector("#rows");
  const show = (f) => {
    const list = papers.filter((p) => f === "all" || p.status === f);
    rows.innerHTML = list.map((p) => paperRow(p, names)).join("") || `<p class="muted pad">Nothing here.</p>`;
  };
  show("all");
  app.querySelector(".filters").onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    app.querySelectorAll(".filter").forEach((x) => x.classList.toggle("active", x === b));
    show(b.dataset.filter);
  };
}

// ---------- Goals ----------
export async function goalsPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [goals, papers] = await Promise.all([api("/topics"), api("/papers")]);
  if (stale()) return;
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head">
      <h1>Goals</h1>
      <p class="lede">Each goal is something you need to understand. Papers are found and grouped around it.</p>
    </div>
    <form class="goal-form" id="goal-form">
      <label for="goal">What are you working on?</label>
      <textarea id="goal" rows="3" required placeholder="e.g. I'm building a retrieval system and need to understand how dense retrievers are trained and evaluated"></textarea>
      <div class="form-foot"><button class="button">Create goal</button></div>
    </form>
    <section class="section">
      ${goals.length ? `<ul class="goal-list">${goals.map((g) => {
        const ps = papers.filter((p) => p.topic_id === g.id);
        const read = ps.filter((p) => p.status === "read").length;
        return `<li><a href="#/goals/${g.id}">
          <span class="goal-text">${esc(g.goal)}</span>
          <span class="goal-meta">${ps.length} papers · ${read} read</span></a></li>`;
      }).join("")}</ul>` : ""}
    </section></div>`;
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
  if (!goal) throw new Error("This goal does not exist.");

  app.innerHTML = `<div class="container page">
    <nav class="crumbs"><a href="#/goals">Goals</a></nav>
    <div class="page-head">
      <p class="eyebrow">Goal</p>
      <h1 class="goal-title">${esc(goal.goal)}</h1>
    </div>
    <section class="section">
      <h2 class="section-title">Your papers <span class="count">${papers.length}</span></h2>
      <div class="paper-table" id="mine">${papers.length ? paperTableHead + papers.map((p) => paperRow(p)).join("")
        : `<p class="muted pad">No papers yet. Find some below.</p>`}</div>
    </section>
    <section class="section">
      <div class="section-bar">
        <h2 class="section-title">Suggestions</h2>
        <button class="button" id="find">Find papers</button>
      </div>
      <div id="suggestions"><p class="muted">Search Semantic Scholar and arXiv for papers that match this goal.</p></div>
    </section></div>`;

  const known = new Set(all.map((p) => p.external_id).filter(Boolean));
  app.querySelector("#find").onclick = (e) => busy(e.target, "Searching…", async () => {
    const box = app.querySelector("#suggestions");
    box.innerHTML = loading("Searching");
    let found;
    try { found = await api(`/topics/${id}/search`); }
    catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    box.innerHTML = found.length ? `<ol class="suggestions">${found.map((p, i) => `
      <li class="suggestion">
        <div class="suggestion-body">
          <h3>${esc(p.title)}</h3>
          <p class="suggestion-meta">${meta(p)}${p.pdf_url ? ` · <span class="tag">Full text</span>` : ""}</p>
          ${p.abstract ? `<details><summary>Abstract</summary><p>${esc(p.abstract)}</p></details>` : ""}
        </div>
        ${known.has(p.external_id) ? `<span class="added">In library</span>`
          : `<button class="button secondary" data-add="${i}">Add</button>`}
      </li>`).join("")}</ol>` : `<p class="muted">No results. Try rewording the goal.</p>`;
    box.onclick = (ev) => {
      const b = ev.target.closest("[data-add]");
      if (b) busy(b, "Adding…", async () => {
        await api("/papers", { method: "POST", json: { ...found[b.dataset.add], topic_id: id } });
        known.add(found[b.dataset.add].external_id);
        b.outerHTML = `<span class="added">In library</span>`;
        const mine = await api(`/papers?topic_id=${id}`);
        app.querySelector("#mine").innerHTML = paperTableHead + mine.map((p) => paperRow(p)).join("");
        app.querySelector(".section-title .count").textContent = mine.length;
      });
    };
  });
}

// ---------- Recall ----------
export async function recallPage() {
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head">
      <h1>Where did I read that?</h1>
      <p class="lede">Describe an idea in your own words. We search the papers you have finished.</p>
    </div>
    <form id="recall" class="recall-form">
      <textarea id="idea" rows="3" required placeholder="e.g. adding noise step by step and learning to reverse it"></textarea>
      <div class="form-foot"><button class="button">Search my papers</button></div>
    </form>
    <div id="results"></div></div>`;
  const input = app.querySelector("#idea");
  input.focus();
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); app.querySelector("#recall").requestSubmit(); } };
  app.querySelector("#recall").onsubmit = (e) => {
    e.preventDefault();
    const box = app.querySelector("#results");
    busy(e.submitter, "Searching…", async () => {
      box.innerHTML = loading("Looking through your papers");
      try {
        const found = await api("/recall", { method: "POST", json: { idea: input.value.trim() } });
        box.innerHTML = found.length ? `<ol class="matches">${found.map((m, i) => `
          <li><a href="#/papers/${m.paper.id}"><span class="match-rank">${i + 1}</span>
            <span><span class="match-title">${esc(m.paper.title)}</span>
            <span class="match-meta">${meta(m.paper)}</span>
            <span class="match-reason">${esc(m.reason)}</span></span></a></li>`).join("")}</ol>`
          : empty("None of your finished papers match that idea. Only papers you mark as finished are searched.");
      } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    });
  };
}

// ---------- Map ----------
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
    <a class="node" href="#/papers/${p.id}">${statusTag(p)}<span class="node-title">${esc(p.title)}</span></a>
    ${children[p.id] ? `<ul>${children[p.id].map(node).join("")}</ul>` : ""}</li>`;

  app.innerHTML = `<div class="container page">
    <div class="page-head">
      <h1>Map</h1>
      <p class="lede">How one paper led you to the next. Open a paper's references and choose "Read this" to extend a chain.</p>
    </div>
    ${trees.length ? `<section class="section"><h2 class="section-title">Reading chains</h2>
      ${trees.map((t) => `<ul class="tree">${node(t)}</ul>`).join("")}</section>`
      : empty("No chains yet. Chains appear when you follow a reference from one paper to another.")}
    ${loose.length ? `<section class="section"><h2 class="section-title">Standalone papers</h2>
      <ul class="loose">${loose.map((p) => `<li><a href="#/papers/${p.id}">${esc(p.title)}</a></li>`).join("")}</ul></section>` : ""}
  </div>`;
}
