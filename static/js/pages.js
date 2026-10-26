import { api, app, bindAddPaper, busy, cite, empty, esc, loading, paperRow, pct, statusTag, STATUS, tableHead, addPaperControl } from "./core.js";

const goalNames = (goals) => Object.fromEntries(goals.map((g) => [g.id, g.goal]));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

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
      ${empty("Nothing here yet. Tell us what you're working on and we'll find papers for it, or add one you already have from a link or PDF.",
        `<div class="empty-actions"><a class="button" href="#/goals">Set a goal</a>${addPaperControl()}</div>`)}</div>`;
    bindAddPaper();
    return;
  }

  const [current, ...others] = papers.filter((p) => p.status === "reading");
  app.innerHTML = `<div class="container page">
    <div class="page-head page-head-split">
      <div><h1>Library</h1>
      <p class="lede">${plural(papers.length, "paper")}, ${count("read")} finished, ${count("reading")} in progress</p></div>
      ${addPaperControl()}
    </div>
    ${current ? `<a class="resume sheet" href="#/papers/${current.id}/read">
        <span class="resume-label">Pick up where you left off</span>
        <span class="resume-title">${esc(current.title)}</span>
        <span class="resume-cite">${cite(current)}</span>
        ${current.resume_text ? `<span class="resume-quote">“${esc(current.resume_text)}”</span>` : ""}
        <span class="resume-foot">Continue at ${pct(current.position)}</span>
      </a>
      ${others.length ? `<p class="also">Also in progress: ${others.map((p) =>
        `<a href="#/papers/${p.id}/read">${esc(p.title)}</a>`).join(", ")}</p>` : ""}` : ""}
    <section class="section">
      <div class="section-bar">
        <h2>All papers</h2>
        <input type="search" id="q" class="search" placeholder="Search titles, authors and full text" aria-label="Search your papers">
        <div class="segmented" role="group" aria-label="Filter by status">
          ${["all", "new", "skimmed", "reading", "read"].map((s) =>
            `<button class="${s === "all" ? "active" : ""}" data-filter="${s}">${s === "all" ? "All" : STATUS[s]}
              <span class="num">${s === "all" ? papers.length : count(s)}</span></button>`).join("")}
        </div>
      </div>
      <div class="sheet table">${tableHead}<div id="rows"></div></div>
    </section></div>`;

  bindAddPaper();
  const rows = app.querySelector("#rows");
  let filter = "all";
  let hits = null; // search results, or null when the search box is empty
  const show = () => {
    const list = (hits ?? papers.map((paper) => ({ paper, snippet: "" })))
      .filter(({ paper }) => filter === "all" || paper.status === filter);
    rows.innerHTML = list.map(({ paper, snippet }) => paperRow(paper, names, snippet)).join("")
      || `<p class="faint pad">${hits ? "No papers match that search." : "No papers with this status."}</p>`;
  };
  show();
  app.querySelector(".segmented").onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    app.querySelectorAll(".segmented button").forEach((x) => x.classList.toggle("active", x === b));
    filter = b.dataset.filter;
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
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head">
      <h1>Goals</h1>
      <p class="lede">Describe what you need to understand. Papers get found and grouped around it.</p>
    </div>
    <form class="sheet form" id="goal-form">
      <label for="goal">What are you working on?</label>
      <textarea id="goal" rows="3" required placeholder="I'm building a retrieval system and need to understand how dense retrievers are trained and evaluated"></textarea>
      <div class="form-foot"><button class="button">Create goal</button></div>
    </form>
    ${goals.length ? `<div class="sheet list">${goals.map((g) => {
      const ps = papers.filter((p) => p.topic_id === g.id);
      const read = ps.filter((p) => p.status === "read").length;
      return `<a class="goal" href="#/goals/${g.id}">
        <span class="goal-text">${esc(g.goal)}</span>
        <span class="goal-count">${plural(ps.length, "paper")}, ${read} finished</span></a>`;
    }).join("")}</div>` : ""}
  </div>`;
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

  const mine = (list) => list.length ? tableHead + list.map((p) => paperRow(p)).join("")
    : `<p class="faint pad">No papers yet. Find some below.</p>`;

  app.innerHTML = `<div class="container page">
    <nav class="crumbs"><a href="#/goals">Goals</a></nav>
    <h1 class="goal-title">${esc(goal.goal)}</h1>
    <section class="section">
      <div class="section-bar"><h2>Your papers <span class="faint num" id="count">${papers.length}</span></h2>${addPaperControl(id)}</div>
      <div class="sheet table" id="mine">${mine(papers)}</div>
    </section>
    <section class="section">
      <div class="section-bar">
        <h2>Find more</h2>
        <button class="button" id="find">Search papers</button>
      </div>
      <div id="suggestions"><p class="faint">Searches Semantic Scholar and arXiv using this goal.</p></div>
    </section></div>`;

  bindAddPaper();
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
        app.querySelector("#count").textContent = list.length;
      });
    };
  });
}

// ---------- Recall ----------
export async function recallPage() {
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head">
      <h1>Where did I read that?</h1>
      <p class="lede">Describe the idea in your own words. Only papers you've finished are searched.</p>
    </div>
    <form id="recall" class="sheet form">
      <label for="idea" class="visually-hidden">The idea</label>
      <textarea id="idea" rows="3" required placeholder="Adding noise step by step, then learning to undo it"></textarea>
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
        box.innerHTML = found.length ? `<div class="sheet list">${found.map((m) => `
          <a class="match" href="#/papers/${m.paper.id}">
            <span class="paper-name">${esc(m.paper.title)}</span>
            <span class="result-cite">${cite(m.paper)}</span>
            <span class="match-reason">${esc(m.reason)}</span></a>`).join("")}</div>`
          : empty("None of your finished papers match. Mark a paper as finished from the reader to add it here.");
      } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
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
    <a class="node" href="#/papers/${p.id}"><span class="paper-name">${esc(p.title)}</span>${statusTag(p)}</a>
    ${children[p.id] ? `<ul>${children[p.id].map(node).join("")}</ul>` : ""}</li>`;

  app.innerHTML = `<div class="container page">
    <div class="page-head">
      <h1>Map</h1>
      <p class="lede">Which paper led you to which. Open a paper's references and pick one to grow a chain.</p>
    </div>
    ${trees.length ? trees.map((t) => `<div class="sheet tree-sheet"><ul class="tree">${node(t)}</ul></div>`).join("")
      : empty("No chains yet. They appear when you follow a reference from one paper to another.")}
    ${loose.length ? `<section class="section"><h2>Not linked to other papers</h2>
      <div class="sheet list">${loose.map((p) => `<a class="loose" href="#/papers/${p.id}">
        <span class="paper-name">${esc(p.title)}</span>${statusTag(p)}</a>`).join("")}</div></section>` : ""}
  </div>`;
}
