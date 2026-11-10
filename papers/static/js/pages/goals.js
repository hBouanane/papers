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
      try { sessionStorage.setItem("roadmap-for", String(g.id)); } catch { /* the button is there anyway */ }
      location.hash = `#/goals/${g.id}`;
    });
  };
}

export async function goalPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [goals, papers, all, plan] = await Promise.all([api("/topics"), api(`/papers?topic_id=${id}`), api("/papers"),
    api(`/topics/${id}/roadmap`).catch(() => null)]);
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
        <h2>Reading roadmap</h2>
        <span class="bar-actions"><button class="button quiet" id="find">Just search</button>
          <button class="button${plan ? " secondary" : ""}" id="make-roadmap">${plan ? "Make a new roadmap" : "Suggest a roadmap"}</button></span>
      </div>
      <div id="roadmap">${plan ? roadmapHtml(plan) : `<p class="faint">The best papers for this goal, in the order to read them:
        the basics first, then the core, then the newest work. You pick which to add; their PDFs are downloaded for you.</p>`}</div>
      <div id="suggestions"></div>
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
  // ----- The reading roadmap -----
  const roadmapBox = app.querySelector("#roadmap");
  const redrawPapers = async () => {
    const list = await api(`/papers?topic_id=${id}`);
    app.querySelector("#mine").innerHTML = mine(list);
    app.querySelector("#shelf").innerHTML = shelf(list);
    drawCovers(app.querySelector("#shelf"));
    const lede = app.querySelector(".page-head .lede");
    if (lede) lede.textContent = `${plural(list.length, "paper")}, ${list.filter((p) => p.status === "read").length} finished.`;
    return list;
  };
  // After papers are added their PDFs arrive one by one: show each first page as it lands (for up to five minutes).
  let watching = 0;
  const watchPdfs = (list) => {
    const run = ++watching;
    let have = list.filter((p) => p.has_pdf).length, tries = 0;
    const tick = async () => {
      if (run !== watching || !roadmapBox.isConnected || ++tries > 60) return;
      try {
        const now = await api(`/papers?topic_id=${id}`);
        const n = now.filter((p) => p.has_pdf).length;
        if (n !== have) { have = n; await redrawPapers(); }
        if (n === now.length) return;
      } catch { /* try again */ }
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 5000);
  };
  const countChosen = () => {
    const n = roadmapBox.querySelectorAll("input[data-pick]:checked").length;
    const add = roadmapBox.querySelector("#roadmap-add");
    if (add) { add.disabled = !n; add.textContent = n ? `Add ${plural(n, "paper")} to this goal` : "Tick the papers you want"; }
  };
  const makeRoadmap = (button) => busy(button, "Working…", async () => {
    app.querySelector("#suggestions").innerHTML = "";
    roadmapBox.innerHTML = `<div class="roadmap-working">${loading("Searching Semantic Scholar and arXiv, then putting the best papers in order")}
      <p class="faint">This takes up to a minute.</p></div>`;
    try {
      const made = await api(`/topics/${id}/roadmap`, { method: "POST" });
      roadmapBox.innerHTML = roadmapHtml(made);
      button.textContent = "Make a new roadmap";
      countChosen();
    } catch (err) { roadmapBox.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
  app.querySelector("#make-roadmap").onclick = (e) => makeRoadmap(e.currentTarget);
  roadmapBox.addEventListener("change", countChosen);
  roadmapBox.addEventListener("click", (e) => {
    const pickAll = e.target.closest("[data-pick-all]");
    if (pickAll) {
      const mode = pickAll.dataset.pickAll;
      roadmapBox.querySelectorAll("input[data-pick]").forEach((c) => (c.checked = mode === "all" || (mode === "stages" && !c.hasAttribute("data-other"))));
      return countChosen();
    }
    const add = e.target.closest("#roadmap-add");
    if (add) busy(add, "Adding…", async () => {
      const chosen = [...roadmapBox.querySelectorAll("input[data-pick]:checked")].map((c) => c.dataset.pick);
      const r = await api(`/topics/${id}/roadmap/add`, { method: "POST", json: { papers: chosen } });
      roadmapBox.innerHTML = roadmapHtml(r);
      chosen.forEach((k) => known.add(k));
      toast(r.added ? `Added ${plural(r.added, "paper")}. Their PDFs are downloading; each is ready to read in a minute or two.`
        : "Added to this goal.");
      const list = await redrawPapers();
      if (r.added) watchPdfs(list);
      countChosen();
    });
  });
  countChosen();
  try {
    if (sessionStorage.getItem("roadmap-for") === String(id)) {
      sessionStorage.removeItem("roadmap-for");
      if (!plan) makeRoadmap(app.querySelector("#make-roadmap"));
    }
  } catch { /* no storage: the button is there */ }
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
        await redrawPapers();
      });
    };
  });
}

// ---------- A goal's reading roadmap ----------
// Stages of papers in reading order. Papers not added yet have a tick box (ticked unless they're only "more results");
// added ones show how far you are, and the first one you haven't finished is "Next up".
const minutes = (m) => m ? (m >= 60 ? `about ${Math.round(m / 6) / 10} h` : `about ${m} min`) : "";
function roadmapHtml(plan) {
  const items = plan.stages.flatMap((s) => s.items);
  const next = items.find((i) => i.paper_id && i.status !== "read");
  const open = [...items, ...plan.others].filter((i) => !i.paper_id).length;
  const fresh = !items.some((i) => i.paper_id && !i.in_library_before); // nothing added yet: the roadmap starts ticked
  const row = (i, other = false) => {
    const key = esc(i.external_id || i.title);
    const state = i.status === "read" ? "Finished" : i.status === "reading" ? "Reading" : "Not started";
    const mark = i.paper_id
      ? `<span class="rm-status rm-${i.status || "unread"}" title="${state}" aria-label="${state}">${i.status === "read" ? "✓" : ""}</span>`
      : `<input type="checkbox" data-pick="${key}" ${other ? "data-other" : fresh ? "checked" : ""} aria-label="Add ${esc(i.title)}">`;
    const title = i.paper_id ? `<a class="paper-name" href="#/papers/${i.paper_id}">${esc(i.title)}</a>` : `<span class="paper-name">${esc(i.title)}</span>`;
    const Tag = i.paper_id ? "div" : "label";
    return `<li class="rm-item${i === next ? " is-next" : ""}"><${Tag} class="rm-row">${mark}
      <span class="rm-body">${i === next ? `<span class="chip chip-reading rm-next">${items[0] === i ? "Start here" : "Next up"}</span>` : ""}${title}
        <span class="result-cite">${cite(i)}${i.citations ? ` · ${i.citations.toLocaleString()} citations` : ""}
          ${i.pdf_url ? `<span class="has-pdf">Full text</span>` : `<span class="no-pdf" title="Added with its abstract; upload the PDF if you have it">No free PDF</span>`}
          ${i.in_library_before ? `<span class="in-library">Already in your library</span>` : ""}</span>
        ${i.reason ? `<span class="rm-reason">${esc(i.reason)}</span>` : ""}</span>
      <span class="rm-time">${minutes(i.minutes)}</span></${Tag}></li>`;
  };
  const total = (list) => list.reduce((t, i) => t + (i.minutes || 0), 0);
  return `<div class="sheet roadmap">
    ${plan.intro ? `<p class="rm-intro">${esc(plan.intro)}</p>` : ""}
    ${plan.stages.length ? `<ol class="rm-stages">${plan.stages.map((s, n) => `<li class="rm-stage">
      <div class="rm-stage-head"><span class="rm-step">${n + 1}</span><span class="rm-stage-title"><strong>${esc(s.title)}</strong>
        ${s.why ? `<span class="hint">${esc(s.why)}</span>` : ""}</span><span class="rm-time">${minutes(total(s.items))}</span></div>
      <ul class="rm-items">${s.items.map((i) => row(i)).join("")}</ul></li>`).join("")}</ol>`
      : `<p class="faint pad">No papers found. Try rewording the goal.</p>`}
    ${plan.others.length ? `<details class="rm-others"><summary>${plural(plan.others.length, "more result")} the roadmap left out</summary>
      <ul class="rm-items">${plan.others.map((i) => row(i, true)).join("")}</ul></details>` : ""}
    ${open ? `<div class="rm-foot"><span class="rm-select">Select: <button type="button" class="link-button" data-pick-all="stages">the roadmap</button>
        · <button type="button" class="link-button" data-pick-all="all">all</button>
        · <button type="button" class="link-button" data-pick-all="none">none</button></span>
      <span class="hint">PDFs are downloaded for you when they're freely available.</span>
      <button type="button" class="button" id="roadmap-add">Add</button></div>` : ""}
  </div>`;
}
