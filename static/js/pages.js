import { api, app, bindAddPaper, bindRows, busy, setBar, cite, empty, esc, loading, paperRow, pct, statusTag, STATUS, tableHead, addPaperControl, toast } from "./core.js";

const goalNames = (goals) => Object.fromEntries(goals.map((g) => [g.id, g.goal]));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- Library ----------
export async function libraryPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [papers, goals, settings, due] = await Promise.all([api("/papers"), api("/topics"), api("/settings"), api("/reviews/due")]);
  if (stale()) return;
  const names = goalNames(goals);
  const folderTip = settings.library_dir ? "" : `<p class="tip">Want your PDFs and notes in a folder on your computer?
    <a href="#/settings">Choose a library folder</a></p>`;
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
      ${addPaperControl("", goals)}
    </div>
    ${folderTip}
    ${due.length ? `<section class="sheet due">
      <h2>Due for review</h2>
      <p class="hint">A couple of minutes now keeps these from fading. Flashcards, no typing.</p>
      ${due.map((d) => `<a class="due-item" href="#/papers/${d.id}/quiz"><span class="paper-name">${esc(d.title)}</span>
        <span class="faint">${d.questions} cards</span></a>`).join("")}
    </section>` : ""}
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
          <button data-filter="archived">Archived</button>
        </div>
        <a class="button quiet" href="/api/bibtex" download>Export BibTeX</a>
      </div>
      <div class="sheet table">${tableHead}<div id="rows"></div></div>
    </section></div>`;

  bindAddPaper();
  const rows = app.querySelector("#rows");
  // Archiving or deleting from the list refreshes the counts.
  bindRows(rows, () => window.dispatchEvent(new HashChangeEvent("hashchange")));
  let filter = "all";
  let hits = null; // search results, or null when the search box is empty
  let archived = []; // loaded when the Archived filter is opened
  const show = () => {
    const pool = hits ?? (filter === "archived" ? archived : papers).map((paper) => ({ paper, snippet: "" }));
    const list = pool.filter(({ paper }) => filter === "all" || paper.status === filter
      || (filter === "archived" && paper.archived));
    rows.innerHTML = list.map(({ paper, snippet }) => paperRow(paper, names, snippet)).join("")
      || `<p class="faint pad">${hits ? "No papers match that search."
        : filter === "archived" ? "Nothing archived. Archive papers that turn out not to be relevant from their More menu."
        : "No papers with this status."}</p>`;
  };
  show();
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
  setBar({ back: { href: "#/goals", label: "Goals" }, title: goal.goal });

  const mine = (list) => list.length ? tableHead + list.map((p) => paperRow(p)).join("")
    : `<p class="faint pad">No papers yet. Find some below.</p>`;

  app.innerHTML = `<div class="container page">
    <h1 class="goal-title">${esc(goal.goal)}</h1>
    <section class="section">
      <div class="section-bar"><h2>Your papers <span class="faint num" id="count">${papers.length}</span></h2>
        <span class="bar-actions"><a class="button quiet" href="/api/bibtex?topic_id=${id}" download>Export BibTeX</a>${addPaperControl(id)}</span></div>
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
      <p class="lede">Describe the idea in your own words. Searches every paper, your notes and the explanations you asked for; finished papers come first.</p>
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
          : empty("Nothing in your library matches that. Try other words for the same idea.");
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

// ---------- Settings ----------
export async function settingsPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const s = await api("/settings");
  if (stale()) return;
  app.innerHTML = `<div class="container page narrow">
    <div class="page-head"><h1>Settings</h1></div>
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
      <h2>Claude</h2>
      <p class="hint">Skimming, explanations, quizzes and recall are done by Claude. Choose how the app reaches it.</p>
      <label class="choice"><input type="radio" name="ai" value="claude-code" ${s.ai_backend === "claude-code" ? "checked" : ""}>
        <span><span><strong>My Claude subscription</strong> (Pro, Max)</span>
        <span class="hint">Runs Claude Code on this computer, signed in with your Claude account. Usage counts toward your plan's limits.
        For your own use only: don't host the app for other people with your subscription.
        ${s.claude_binary ? `Found Claude Code at <code>${esc(s.claude_binary)}</code>.`
          : "Claude Code isn't installed yet: get it from claude.com/claude-code."}
        First time: open a terminal, run <code>claude</code>, type <code>/login</code> and sign in.</span></span></label>
      <label class="choice"><input type="radio" name="ai" value="api" ${s.ai_backend === "api" ? "checked" : ""}>
        <span><strong>API key</strong>
        <span class="hint">Pay per use on the Anthropic API. Set <code>ANTHROPIC_API_KEY</code> before starting the app.
        ${s.api_key_set ? "A key is set." : "No key is set."}</span></span></label>
      <div class="form-foot"><button type="button" class="button secondary" id="ai-test">Test connection</button></div>
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
  app.querySelector("#lang-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const saved = await api("/settings", { method: "PUT", json: { language: app.querySelector("#lang").value } });
      toast(saved.language ? `Translations will be in ${saved.language}.` : "Translations turned off.");
    });
  };
  const aiStatus = app.querySelector("#ai-status");
  app.querySelector("#ai-form").onchange = async (e) => {
    if (e.target.name !== "ai") return;
    const saved = await api("/settings", { method: "PUT", json: { ai_backend: e.target.value } });
    aiStatus.className = "hint";
    aiStatus.textContent = saved.ai_ready ? "Saved. Use Test connection to check it works."
      : saved.ai_backend === "api" ? "Saved, but no API key is set." : "Saved, but Claude Code wasn't found on this computer.";
  };
  app.querySelector("#ai-test").onclick = (e) => busy(e.currentTarget, "Asking Claude…", async () => {
    const r = await api("/ai/test", { method: "POST" });
    aiStatus.className = r.ok ? "hint ok" : "error";
    aiStatus.textContent = r.message;
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
