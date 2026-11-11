// Goals: what you're working on, each with its papers; and one goal's page.
import { addPaperControl, api, app, bindAddPaper, bindRows, busy, cite, empty, esc, loading, moreButton, PAGE, paperRow, setBar, tableHead, toast } from "../core.js";
import { cover, drawCovers } from "../covers.js";
import { iconButton } from "../icons.js";
import { coverFan, looseCard, paperCard, plural, shorten } from "./shared.js";
import { sampleBackdrop, sampleCover } from "./welcome.js";

// ---------- Goals ----------
// Goals to start from, for a first goal.
const EXAMPLES = [
  "I want to understand how diffusion models turn noise into images",
  "I'm writing a review on CRISPR base editing and its off-target effects",
  "I need to catch up on causal inference for observational studies",
  "I'm building a retrieval system and need to know how dense retrievers are trained",
];

// What a goal gets you, drawn: three stages of stand-in papers.
const STAGES = [["The basics", "Start here", [1]], ["The core", "The methods that matter", [0, 2]], ["The newest work", "Where the field is now", [1, 0]]];
const stagesPicture = () => `<ol class="gf-stages">${STAGES.map(([name, note, covers], i) => `<li class="gf-stage" style="--i:${i}">
  <span class="step-n num">${i + 1}</span>
  <span class="gf-stage-text"><strong>${name}</strong><span>${note}</span></span>
  <span class="gf-covers">${covers.map((c) => sampleCover(c)).join("")}</span></li>`).join("")}</ol>`;

// Your papers, big, behind the Goals page once you have goals (Recall's fan); stand-ins until there are papers.
function goalsBackdrop(papers) {
  const order = [...papers].sort((a, b) => (b.status === "reading") - (a.status === "reading") || b.has_pdf - a.has_pdf);
  return order.length ? `<div class="recall-backdrop" id="backdrop" aria-hidden="true"><span class="recall-hero">${coverFan(order)}</span></div>`
    : sampleBackdrop().replace('class="recall-backdrop', 'id="backdrop" class="recall-backdrop');
}

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
  // The first time: a picture of what a goal gets you. Later: your own papers fanned out behind the page.
  const first = !goals.length;
  app.innerHTML = `${first ? "" : goalsBackdrop(papers)}<div class="container page${first ? "" : " recall-page goals-page"}">
    <div class="page-head">
      <h1 class="page-title">Goals</h1>
      <p class="lede">Say what you're trying to understand. Papers finds the papers for it and puts them in reading order.</p>
    </div>
    <form class="sheet goal-finder${first ? "" : " gf-solo"}" id="goal-form">
      <div class="gf-form">
        <label for="goal">What do you want to understand?</label>
        <textarea id="goal" rows="3" required placeholder="I'm building a retrieval system and need to understand how dense retrievers are trained and evaluated"></textarea>
        <div class="gf-foot"><span class="hint">Finding papers searches Semantic Scholar and arXiv. You choose which to keep.</span>
          <span class="gf-buttons"><button class="button quiet" data-plain>Create without searching</button>
            <button class="button">Find papers</button></span></div>
        ${!first ? "" : `<div class="goal-examples"><span class="hint">Or start from an example</span>
          <div class="try-ideas" id="goal-examples">${EXAMPLES.map((x) => `<button type="button" class="try-idea">${esc(x)}</button>`).join("")}</div></div>`}
      </div>
      ${first ? `<div class="gf-show" aria-hidden="true">
        <span class="chain-label">What you get</span><span class="gf-show-title">A reading roadmap</span>
        ${stagesPicture()}
      </div>` : ""}
    </form>
    ${goals.length ? `<section class="page-section"><h2>Your goals</h2>
      <div class="goal-cards">${goals.map(card).join("")}</div></section>` : ""}
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
  app.querySelector("#goal-examples")?.addEventListener("click", (e) => {
    const pick = e.target.closest(".try-idea");
    if (!pick) return;
    app.querySelector("#goal").value = pick.textContent;
    app.querySelector("#goal").focus();
  });
  app.querySelector("#goal-form").onsubmit = (e) => {
    e.preventDefault();
    const search = !e.submitter?.hasAttribute("data-plain"); // "Create without searching" only makes the goal
    if (search) app.querySelector("#backdrop")?.classList.add("searching");
    busy(e.submitter, search ? "Starting…" : "Creating…", async () => {
      try {
        const g = await api("/topics", { method: "POST", json: { goal: app.querySelector("#goal").value.trim() } });
        try { if (search) sessionStorage.setItem("roadmap-for", String(g.id)); } catch { /* the button is there anyway */ }
        location.hash = `#/goals/${g.id}`;
      } finally { app.querySelector("#backdrop")?.classList.remove("searching"); }
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

  const byId = new Map(all.map((p) => [p.id, p]));
  let mineShown = PAGE;
  let mineList = papers;
  const mine = (list) => (mineList = list).length ? tableHead + list.slice(0, mineShown).map((p) => paperRow(p)).join("")
    + moreButton(list.length - mineShown) : `<p class="faint pad">No papers yet. Find some below.</p>`;
  const shelf = (list) => list.length ? `<div class="shelf goal-shelf">${list.map((p) => paperCard(p)).join("")}</div>`
    : `<div class="desk-empty">No papers in this goal yet. Find some below, or add one you already have.</div>`;
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
      <div class="goal-head"><h1 class="page-title goal-title">${esc(goal.goal)}</h1>
      <div class="goal-sub"><p class="lede">${plural(papers.length, "paper")}, ${read} finished.</p>
      <span class="goal-manage">${iconButton("edit", "Rename this goal", { attrs: 'id="goal-rename"' })}${iconButton("trash", "Delete this goal", { attrs: 'id="goal-delete"' })}</span></div></div>
      <span class="bar-actions"><a class="button quiet" href="/api/bibtex?topic_id=${id}" download>Export BibTeX</a>${addPaperControl(id)}</span>
    </div>
    <section>
      <div id="shelf">${shelf(papers)}</div>
      <details class="as-list"><summary>Show as a list (archive, delete)</summary>
        <div class="sheet table" id="mine">${mine(papers)}</div></details>
    </section>
    ${says(papers)}
    <section class="section rm-section${plan ? "" : " no-plan"}" id="rm-section">
      <div class="section-bar">
        <h2>Reading roadmap</h2>
        <span class="bar-actions"><button class="button quiet" id="find">Just search</button>
          <button class="button${plan ? " secondary" : ""}" id="make-roadmap">${plan ? "Make a new roadmap" : "Suggest a roadmap"}</button></span>
      </div>
      <div id="roadmap">${plan ? roadmapHtml(plan, byId) : `<div class="sheet rm-start">
        <div class="rm-start-text"><span class="chain-label">Find papers for this goal</span>
          <h3>Want a reading roadmap?</h3>
          <p class="hint">Papers searches Semantic Scholar and arXiv and puts the best papers in the order to read them: the basics
            first, then the core, then the newest work. You pick which to add; their PDFs are downloaded for you.</p>
          <div class="rm-start-actions"><button class="button" data-go="roadmap">Suggest a roadmap</button>
            <button class="button secondary" data-go="find">Just search</button></div>
          <p class="hint">Or skip this and add your own papers with <strong>Add paper</strong>.</p></div>
        <div class="rm-start-show" aria-hidden="true">${stagesPicture()}</div></div>`}</div>
      <div id="suggestions"></div>
    </section></div>`;

  bindAddPaper();
  drawCovers(app);
  // ----- Rename or delete the goal -----
  app.querySelector("#goal-rename").onclick = () => {
    const title = app.querySelector(".goal-title");
    if (app.querySelector("#goal-name")) return app.querySelector("#goal-name").focus();
    title.hidden = true;
    title.insertAdjacentHTML("afterend", `<form class="goal-rename" id="goal-rename-form">
      <textarea id="goal-name" rows="3" required aria-label="The goal, in a few words">${esc(goal.goal)}</textarea>
      <div class="goal-rename-foot"><button class="button">Save</button>
        <button type="button" class="button quiet" id="goal-rename-cancel">Cancel</button></div></form>`);
    const form = app.querySelector("#goal-rename-form");
    const close = () => { form.remove(); title.hidden = false; };
    form.querySelector("textarea").select();
    form.querySelector("#goal-rename-cancel").onclick = close;
    form.onkeydown = (e) => { if (e.key === "Escape") close(); };
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, "Saving…", async () => {
        const saved = await api(`/topics/${id}`, { method: "PATCH", json: { goal: form.querySelector("textarea").value.trim() } });
        goal.goal = saved.goal;
        title.textContent = saved.goal;
        setBar({ back: { href: "#/goals", label: "Goals" }, title: saved.goal });
        close();
        toast("Goal renamed. The roadmap was made for the old words; make a new one if the goal changed.");
      });
    };
  };
  app.querySelector("#goal-delete").onclick = async (e) => {
    const n = (await api(`/papers?topic_id=${id}`)).length;
    if (!confirm(`Delete the goal "${shorten(goal.goal, 80)}"?\n\n${n ? `Its ${plural(n, "paper")} stay in your library, in no goal.` : "It has no papers."} Its roadmap is removed.`)) return;
    busy(e.target.closest("button"), "", async () => {
      await api(`/topics/${id}`, { method: "DELETE" });
      toast("Goal deleted. Its papers are still in your library.");
      location.hash = "#/goals";
    });
  };
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
  const section = app.querySelector("#rm-section");
  const makeButton = app.querySelector("#make-roadmap");
  const makeRoadmap = () => busy(makeButton, "Working…", async () => {
    app.querySelector("#suggestions").innerHTML = "";
    section.classList.remove("no-plan");
    const stop = searchScene(roadmapBox, ["Writing search queries for your goal", "Searching Semantic Scholar and arXiv",
      "Reading what came back", "Putting the best papers in reading order"], "This takes up to a minute.");
    try {
      const made = await api(`/topics/${id}/roadmap`, { method: "POST" });
      roadmapBox.innerHTML = roadmapHtml(made, byId, true);
      drawCovers(roadmapBox);
      makeButton.classList.add("secondary");
      countChosen();
      return true;
    } catch (err) { roadmapBox.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    finally { stop(); }
  }).then((made) => { if (made) makeButton.textContent = "Make a new roadmap"; });
  makeButton.onclick = makeRoadmap;
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
      roadmapBox.innerHTML = roadmapHtml(r, byId);
      drawCovers(roadmapBox);
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
      if (!plan) makeRoadmap();
    }
  } catch { /* no storage: the button is there */ }
  // The start card's own buttons (shown until there is a roadmap).
  roadmapBox.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) (go.dataset.go === "find" ? find(go) : makeRoadmap());
  });
  const find = (button) => busy(button, "Searching…", async () => {
    const box = app.querySelector("#suggestions");
    const stop = searchScene(box, ["Writing search queries for your goal", "Searching Semantic Scholar and arXiv"], "A few seconds.");
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    let found;
    try { found = await api(`/topics/${id}/search`); }
    catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
    finally { stop(); }
    box.innerHTML = found.length ? `<h3 class="found-title">${plural(found.length, "paper")} found</h3>
      <div class="sheet list found">${found.map((p, i) => `
      <div class="result" style="--n:${Math.min(i, 12)}">
        <span class="rm-cover" aria-hidden="true">${cover({ id: "", title: p.title }, "small")}</span>
        <div class="result-body">
          <h3 class="paper-name">${esc(p.title)}</h3>
          <p class="result-cite"><span>${cite(p)}</span>${p.citations ? `<span>${p.citations.toLocaleString()} citations</span>` : ""}${p.pdf_url ? `<span class="rm-tag">Free PDF</span>` : ""}</p>
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
  app.querySelector("#find").onclick = (e) => find(e.currentTarget);
}

// ---------- Searching ----------
// What shows while papers are being found: stand-in papers dealt out under a magnifying glass, and the steps of
// the search ticking by. The request itself is one call, so the steps follow the clock, and the last one waits.
function searchScene(box, steps, note) {
  box.innerHTML = `<div class="sheet finding" role="status">
    <div class="fd-stage" aria-hidden="true">${[1, 0, 2, 1, 0, 2, 1].map((c, i) => `<span class="fd-paper" style="--i:${i}">${sampleCover(c)}</span>`).join("")}
      <span class="fd-lens"></span></div>
    <ol class="fd-steps">${steps.map((s, i) => `<li${i ? "" : ' class="is-now"'}>${s}</li>`).join("")}</ol>
    <p class="hint">${note}</p></div>`;
  const items = [...box.querySelectorAll(".fd-steps li")];
  let at = 0;
  const timer = setInterval(() => {
    if (at >= items.length - 1) return clearInterval(timer);
    items[at].className = "is-done";
    items[++at].className = "is-now";
  }, steps.length > 2 ? 4500 : 2500);
  return () => clearInterval(timer);
}

// ---------- A goal's reading roadmap ----------
// Stages of papers in reading order. Papers not added yet have a tick box (ticked unless they're only "more results");
// added ones show how far you are, and the first one you haven't finished is "Next up".
const minutes = (m) => m ? (m >= 60 ? `about ${Math.round(m / 6) / 10} h` : `about ${m} min`) : "";
function roadmapHtml(plan, byId = new Map(), enter = false) {
  const items = plan.stages.flatMap((s) => s.items);
  const next = items.find((i) => i.paper_id && i.status !== "read");
  const open = [...items, ...plan.others].filter((i) => !i.paper_id).length;
  const fresh = !items.some((i) => i.paper_id && !i.in_library_before); // nothing added yet: the roadmap starts ticked
  let n = 0; // the order rows come in, when the roadmap has just been made
  const row = (i, other = false) => {
    const key = esc(i.external_id || i.title);
    const state = i.status === "read" ? "Finished" : i.status === "reading" ? "Reading" : "Not started";
    const mark = i.paper_id
      ? `<span class="rm-status rm-${i.status || "unread"}" title="${state}" aria-label="${state}">${i.status === "read" ? "✓" : ""}</span>`
      : `<input type="checkbox" data-pick="${key}" ${other ? "data-other" : fresh ? "checked" : ""} aria-label="Add ${esc(i.title)}">`;
    const title = i.paper_id ? `<a class="paper-name" href="#/papers/${i.paper_id}">${esc(i.title)}</a>` : `<span class="paper-name">${esc(i.title)}</span>`;
    const Tag = i.paper_id ? "div" : "label";
    const page = cover({ id: i.paper_id || "", title: i.title, has_pdf: byId.get(i.paper_id)?.has_pdf }, "small");
    return `<li class="rm-item${i === next ? " is-next" : ""}" style="--n:${Math.min(n++, 14)}"><${Tag} class="rm-row">${mark}
      <span class="rm-cover" aria-hidden="true">${page}</span>
      <span class="rm-body">${i === next ? `<span class="chip chip-reading rm-next">${items[0] === i ? "Start here" : "Next up"}</span>` : ""}${title}
        <span class="result-cite"><span>${cite(i)}</span>${i.citations ? `<span>${i.citations.toLocaleString()} citations</span>` : ""}
          ${i.pdf_url ? `<span class="rm-tag">Free PDF</span>` : `<span class="rm-tag rm-tag-none" title="Added with its abstract; upload the PDF if you have it">No free PDF</span>`}
          ${i.in_library_before ? `<span class="rm-tag rm-tag-have">Already in your library</span>` : ""}</span>
        ${i.reason ? `<span class="rm-reason">${esc(i.reason)}</span>` : ""}</span>
      <span class="rm-time">${minutes(i.minutes)}</span></${Tag}></li>`;
  };
  const total = (list) => list.reduce((t, i) => t + (i.minutes || 0), 0);
  const done = items.filter((i) => i.status === "read").length;
  return `<div class="roadmap${enter ? " rm-enter" : ""}">
    ${plan.stages.length ? `<div class="rm-top">
      ${plan.intro ? `<p class="rm-intro">${esc(plan.intro)}</p>` : ""}
      <p class="rm-sum"><span><strong class="num">${items.length}</strong> ${items.length === 1 ? "paper" : "papers"}</span>
        ${plan.stages.length > 1 ? `<span><strong class="num">${plan.stages.length}</strong> stages</span>` : ""}
        ${total(items) ? `<span><strong>${minutes(total(items)).replace("about ", "")}</strong> of reading</span>` : ""}
        ${done ? `<span><strong class="num">${done}</strong> finished</span>` : ""}</p></div>
    <ol class="rm-stages">${plan.stages.map((s, k) => `<li class="rm-stage" style="--s:${k}">
      <span class="rm-step num" aria-hidden="true">${k + 1}</span>
      <div class="sheet rm-card">
        <div class="rm-stage-head"><span class="rm-stage-title"><strong>${esc(s.title)}</strong>
          ${s.why ? `<span class="hint">${esc(s.why)}</span>` : ""}</span><span class="rm-time">${minutes(total(s.items))}</span></div>
        <ul class="rm-items">${s.items.map((i) => row(i)).join("")}</ul></div></li>`).join("")}</ol>`
      : `<p class="faint pad">No papers found. Try rewording the goal.</p>`}
    ${plan.others.length ? `<details class="sheet rm-others"><summary>${plural(plan.others.length, "more result")} the roadmap left out</summary>
      <ul class="rm-items">${plan.others.map((i) => row(i, true)).join("")}</ul></details>` : ""}
    ${open ? `<div class="rm-foot"><span class="rm-select">Select: <button type="button" class="link-button" data-pick-all="stages">the roadmap</button>
        · <button type="button" class="link-button" data-pick-all="all">all</button>
        · <button type="button" class="link-button" data-pick-all="none">none</button></span>
      <span class="hint">PDFs are downloaded for you when they're freely available.</span>
      <button type="button" class="button" id="roadmap-add">Add</button></div>` : ""}
  </div>`;
}
