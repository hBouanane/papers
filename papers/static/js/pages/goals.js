// Goals: what you're working on, each with its papers; and one goal's page.
import { addPaperControl, api, app, bindAddPaper, bindRows, busy, cite, empty, esc, loading, moreButton, PAGE, paperRow, setBar, tableHead, toast } from "../core.js";
import { cover, drawCovers } from "../covers.js";
import { coverFan, looseCard, paperCard, plural, shorten } from "./shared.js";

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
        <p class="hint">Point at one to add it to a goal or start reading it.</p>
        <div class="shelf goal-shelf" id="loose">${loose.slice(0, 12).map((p) => looseCard(p, goals)).join("")}</div></section>` : "";
    })()}
  </div>`;
  drawCovers(app);
  // Add a paper to a goal from its card; the page redraws, so it moves into that goal's fan.
  app.querySelector("#loose")?.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-goal]");
    if (!pick) return;
    const card = pick.closest("[data-paper]");
    busy(pick, "Adding…", async () => {
      await api(`/papers/${card.dataset.paper}`, { method: "PATCH", json: { topic_id: Number(pick.dataset.goal) } });
      toast(`Added to "${shorten(goals.find((g) => g.id === Number(pick.dataset.goal)).goal, 50)}".`);
      goalsPage(stale);
    });
  });
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

  let mineShown = PAGE;
  let mineList = papers;
  const mine = (list) => (mineList = list).length ? tableHead + list.slice(0, mineShown).map((p) => paperRow(p)).join("")
    + moreButton(list.length - mineShown) : `<p class="faint pad">No papers yet. Find some below.</p>`;
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
  app.querySelector(".as-list")?.addEventListener("toggle", () => drawCovers(app.querySelector("#mine")));
  app.querySelector("#mine").addEventListener("click", (e) => {
    if (!e.target.closest("[data-more]")) return;
    mineShown += PAGE;
    e.currentTarget.innerHTML = mine(mineList);
    drawCovers(e.currentTarget);
  });
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
