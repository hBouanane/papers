// A paper's page: key points, figures, words, notes and references, with its details and chain.
import { api, app, busy, cameFrom, cite, esc, loading, pct, progressBar, renderVocab, setBar, statusTag, toast } from "../core.js";
import { cover, drawCovers, forgetCover } from "../covers.js";
import { bindNotesList, noteStore } from "../notes.js";
import { linkFigures, renderFigures, showFigure } from "./figures.js";
import { celebrate, minutes } from "./shared.js";

// ---------- Overview ----------
const TABS = [["overview", "Overview"], ["figures", "Figures & tables"], ["words", "Words"], ["notes", "Notes"], ["refs", "References"]];
const prepared = (p) => p.skim && p.glossary && p.quiz && p.refs;

export async function paperPage(id, stale, tab = "overview") {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [p, goals, chain, settings] = await Promise.all([api(`/papers/${id}`), api("/topics"), api(`/papers/${id}/chain`), api("/settings")]);
  if (stale()) return;
  const goal = goals.find((g) => g.id === p.topic_id);
  const readLabel = { new: "Start reading", skimmed: "Start reading", reading: `Continue reading`, read: "Read again" }[p.status];
  const ancestors = chain.path.slice(0, -1);
  const readable = p.text || p.has_pdf;
  // Back goes where you came from: a goal, Recall, the Map, another paper; the Library otherwise.
  const from = cameFrom(`/papers/${id}`) || "/";
  const fromGoal = goals.find((g) => from === `/goals/${g.id}`);
  const SECTIONS = { "/goals": "Goals", "/recall": "Recall", "/map": "Map", "/settings": "Settings" };
  const back = fromGoal ? { href: `#${from}`, label: fromGoal.goal }
    : SECTIONS[from] ? { href: `#${from}`, label: SECTIONS[from] }
    : /^\/papers\/\d+$/.test(from) ? { href: `#${from}`, label: "the previous paper" }
    : { href: "#/", label: "Library" };
  setBar({ back, title: p.title });

  app.innerHTML = `<div class="container page">
    <header class="paper-header" id="header">
      ${readable ? `<a class="cover-link" href="#/papers/${id}/read" tabindex="-1" aria-hidden="true">${cover(p, "large")}</a>` : cover(p, "large")}
      <div class="paper-header-text">
      <h1 class="paper-name paper-h1">${esc(p.title)}</h1>
      ${p.authors || p.year ? `<p class="paper-cite">${esc(p.authors)}${p.year ? ` (${p.year})` : ""}</p>` : ""}
      <div class="actions">
        ${readable ? `<a class="button" href="#/papers/${id}/read">${readLabel}</a>`
          : `<label class="button"><span>Upload the PDF</span><input type="file" class="pdf-input" accept="application/pdf,.pdf" hidden></label>`}
        ${p.quiz?.length && p.status === "read" ? `<a class="button secondary" href="#/papers/${id}/quiz">${p.understanding == null ? "Test yourself" : "Review"}</a>` : ""}
        ${p.url ? `<a class="button quiet" href="${esc(p.url)}" target="_blank" rel="noopener">Source</a>` : ""}
        <details class="menu">
          <summary class="button quiet">More</summary>
          <div class="menu-list sheet" role="menu">
            <button role="menuitem" id="edit">Edit details</button>
            ${readable ? `<label role="menuitem"><span>${p.has_pdf ? "Replace PDF" : "Upload the PDF"}</span><input type="file" class="pdf-input" accept="application/pdf,.pdf" hidden></label>` : ""}
            <button role="menuitem" id="copy-bib">Copy BibTeX</button>
            ${p.status !== "read" ? `<button role="menuitem" id="mark-read">Mark as read</button>` : ""}
            <button role="menuitem" id="archive">${p.archived ? "Restore from archive" : "Archive (not relevant)"}</button>
            <button role="menuitem" id="delete" class="danger">Delete paper</button>
          </div>
        </details>
      </div>
      ${p.archived ? `<p class="hint">This paper is archived: it's hidden from your lists but still searchable.</p>` : ""}
      ${!readable ? `<p class="hint">The full text wasn't available online. Upload the PDF to read it here.</p>` : ""}
      ${p.has_pdf && !p.text ? `<p class="hint">This PDF has no selectable text, so it's probably a scan. You can read it,
        but key points, explanations and questions need text.</p>` : ""}
      </div>
    </header>

    <div class="paper-layout">
      <div class="paper-main">
        <div class="tabs" role="tablist">${TABS.map(([key, label]) =>
          `<button role="tab" data-tab="${key}" aria-selected="${key === tab}">${label}</button>`).join("")}</div>
        <section class="sheet pad-lg tab-panel" id="panel" role="tabpanel"></section>
      </div>
      <aside class="paper-side">
        <div class="sheet facts">
          <div><span>Status</span>${statusTag(p)}</div>
          <div><span>Read</span><span class="fact-bar">${progressBar(p)}<span class="num">${pct(p.progress)}</span></span></div>
          <div><span>Understood</span><span class="num">${p.understanding == null ? `<span class="faint">Not tested</span>` : pct(p.understanding)}</span></div>
          ${p.text ? `<div><span>Length</span><span>${minutes(p.text)} min</span></div>` : ""}
        </div>
        ${ancestors.length ? `<div class="sheet trail"><h3>Found through</h3>
          ${ancestors.map((a) => `<a href="#/papers/${a.id}">${esc(a.title)}</a>`).join("")}</div>` : ""}
        ${chain.children.length ? `<div class="sheet trail"><h3>Led you to</h3>
          ${chain.children.map((c) => `<a href="#/papers/${c.id}">${esc(c.title)}</a>`).join("")}</div>` : ""}
      </aside>
    </div></div>`;

  drawCovers(app.querySelector("#header"));
  const panel = app.querySelector("#panel");
  // Each time a tab opens it gets a fresh box in the panel. Switching tabs removes the old box, so something that
  // was still loading for it (figures being cut out, references) finds it gone and doesn't land in the new tab.
  const showTab = (key) => {
    tab = key;
    app.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === key));
    const box = document.createElement("div");
    box.className = "tab-body";
    panel.replaceChildren(box);
    if (key === "overview") renderOverview(box, p, settings, regenerate);
    else if (key === "figures") renderFigures(box, p);
    else if (key === "words") {
      if (!p.glossary && p.preparing) box.innerHTML = preparingNote("the hard words");
      else renderVocab(box, p);
    } else if (key === "notes") {
      box.innerHTML = `<h2>Notes and highlights</h2><div id="overview-notes"></div>`;
      const store = noteStore(id);
      bindNotesList(box.querySelector("#overview-notes"), store, {
        here: () => ({ position: p.position || 0 }),
        jump: (note) => {
          try { sessionStorage.setItem(`papers.jump.${id}`, note.id); } catch { /* opens at the last place instead */ }
          location.hash = `#/papers/${id}/read`;
        },
      });
      store.load().catch((e) => toast(e.message));
    } else loadRefs(box, p);
  };
  app.querySelector(".tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) showTab(b.dataset.tab);
  };
  showTab(tab);

  // The AI reads the paper ahead of time; while it does, the tabs fill in as results arrive.
  async function prepareAndWatch(redo = []) {
    if (!p.preparing || redo.length) await api(`/papers/${id}/prepare`, { method: "POST", json: { redo } });
    redo.forEach((k) => (p[k] = null));
    p.preparing = true;
    showTab(tab);
    const started = Date.now();
    const poll = setInterval(async () => {
      if (stale() || Date.now() - started > 5 * 60 * 1000) return clearInterval(poll);
      const fresh = await api(`/papers/${id}`).catch(() => null);
      if (!fresh) return;
      const changed = ["skim", "glossary", "quiz", "refs"].some((k) => !p[k] && fresh[k]);
      Object.assign(p, { skim: fresh.skim, glossary: fresh.glossary, quiz: fresh.quiz, refs: fresh.refs, preparing: fresh.preparing });
      if (changed || !fresh.preparing) showTab(tab);
      if (!fresh.preparing) clearInterval(poll);
    }, 3000);
  }
  // Write the key points, words and questions again with the model chosen now.
  async function regenerate(button) {
    await busy(button, "Starting…", () => prepareAndWatch(["skim", "glossary", "quiz"]));
  }
  if (settings.ai_ready && p.text && !prepared(p)) await prepareAndWatch().catch(() => {});

  const menu = app.querySelector(".menu");
  app.querySelector("#edit").onclick = () => { menu.open = false; editDetails(p, goals); };
  app.querySelector("#mark-read")?.addEventListener("click", (e) => busy(e.currentTarget, "Marking…", async () => {
    await api(`/papers/${id}/finish`, { method: "POST" });
    celebrate();
    paperPage(id, stale, tab);
  }));
  app.querySelector("#copy-bib").onclick = async () => {
    menu.open = false;
    const bib = await (await fetch(`/api/papers/${id}/bibtex`)).text();
    try { await navigator.clipboard.writeText(bib); toast("BibTeX copied."); }
    catch { toast("Couldn't reach the clipboard. Use Export BibTeX on the Library page instead."); }
  };
  app.querySelector("#archive").onclick = (e) => busy(e.currentTarget, "Saving…", async () => {
    await api(`/papers/${id}`, { method: "PATCH", json: { archived: !p.archived } });
    toast(p.archived ? "Restored to your library." : "Archived. Find it under Archived in the Library.");
    paperPage(id, stale, tab);
  });
  app.querySelector("#delete").onclick = (e) => {
    if (!confirm(`Delete "${p.title}"? Its PDF, notes and explanations are removed too. This can't be undone.`)) return;
    busy(e.currentTarget, "Deleting…", async () => {
      await fetch(`/api/papers/${id}`, { method: "DELETE" });
      toast("Paper deleted.");
      location.hash = goal ? `#/goals/${goal.id}` : "#/";
    });
  };
  app.querySelectorAll(".pdf-input").forEach((input) => input.addEventListener("change", (e) => uploadPdf(id, e.target.files[0])));
}

const preparingNote = (what) => `<div class="preparing"><span class="dot-pulse" aria-hidden="true"></span>
  <p>The AI is reading this paper and preparing ${what}. This takes a minute or two, once; you can start reading meanwhile.</p></div>`;

function renderOverview(box, p, settings, regenerate) {
  const s = p.skim;
  const abstractFirst = p.paper_abstract ? `<section class="abstract-first">
      <h2>Abstract <span class="faint abstract-source">${p.abstract_from_paper ? "From the paper" : "From the paper's listing"}</span></h2>
      <p class="fold-text">${esc(p.paper_abstract)}</p></section>` : "";
  const made = p.made_by?.skim;
  const now = settings.ai_name;
  const writtenBy = made
    ? `Written by <strong>${esc(made.model)}</strong> (${esc(made.provider)}).${made.model !== now ? ` You're using <strong>${esc(now)}</strong> now; Regenerate to write them again with it.` : " A stronger model can do better."}`
    : `Written by an AI model. A stronger one can do better: you're using <strong>${esc(now)}</strong>.`;
  const redo = settings.ai_ready && p.text ? `<div class="regenerate">
      <p class="hint">${writtenBy}</p>
      <button class="button secondary small" id="regenerate" title="Writes the key points, vocabulary and review questions again. Your notes and highlights stay.">Regenerate with ${esc(settings.ai_name)}</button></div>`
    : p.text ? `<div class="regenerate"><p class="hint">Written by an AI model. To write them again with another one, choose it in
      <a href="#/settings">Settings</a>; a Regenerate button then appears here.</p></div>` : "";
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const fold = (title, body, open = false) => body ? `<details class="fold"${open ? " open" : ""}><summary>${title}</summary>${body}</details>` : "";
  const abstract = "";
  if (!s) {
    box.innerHTML = p.preparing ? `${abstractFirst}${preparingNote("its key points")}`
      : settings.ai_ready && p.text ? `${abstractFirst}<h2>Key points</h2><p class="hint">A first pass on the paper in plain English, before you read it.</p>
          <button class="button" id="skim-btn">Get key points</button>${abstract}`
      : `<p class="hint">${p.text ? `Choose an AI model in <a href="#/settings">Settings</a> to get key points, words and questions.`
          : "Upload the PDF to get key points."}</p>${abstractFirst}`;
    box.querySelector("#skim-btn")?.addEventListener("click", (e) => busy(e.currentTarget, "Reading the paper…", async () => {
      p.skim = await api(`/papers/${p.id}/skim`, { method: "POST" });
      renderOverview(box, p, settings);
    }));
    return;
  }
  // Older key points have fewer fields; show what's there.
  box.innerHTML = `${abstractFirst}<h2 class="key-points-head">Key points</h2>
    ${s.tldr ? `<p class="tldr">${esc(s.tldr)}</p>` : ""}
    <div class="callouts">
      <div class="callout"><span class="callout-label">Verdict</span><p>${esc(s.verdict)}</p></div>
      ${s.relevance ? `<div class="callout"><span class="callout-label">For your goal</span><p>${esc(s.relevance)}</p></div>` : ""}
    </div>
    ${s.key_idea ? `<p class="key-idea"><span class="callout-label">Key idea</span>${esc(s.key_idea)}</p>` : ""}
    ${fold("Reading plan", s.reading_plan?.length ? list(s.reading_plan) : "", true)}
    ${fold("Questions to keep in mind", s.questions?.length ? list(s.questions) : "")}
    ${fold("Problem and method", `${s.problem ? `<p class="fold-text">${esc(s.problem)}</p>` : ""}${s.method ? `<p class="fold-text">${esc(s.method)}</p>` : ""}`)}
    ${fold("What's new", s.contributions?.length ? list(s.contributions) : "")}
    ${fold("Results", s.results?.length ? list(s.results) : "")}
    ${fold("Limitations", s.limitations?.length ? list(s.limitations) : "")}
    ${fold("Figures to look at", s.figures?.length ? `<ul>${s.figures.map((f) => `<li>${linkFigures(esc(f))}</li>`).join("")}</ul>` : "", true)}
    ${fold("Read closely", s.read_closely?.length ? list(s.read_closely) : "")}
    ${redo}`;
  box.querySelector("#regenerate")?.addEventListener("click", (e) => regenerate(e.currentTarget));
  box.addEventListener("click", async (e) => {
    const link = e.target.closest(".fig-link");
    if (!link) return;
    const items = await busy(link, "", () => api(`/papers/${p.id}/figures`));
    const item = items?.find((f) => f.kind === link.dataset.kind && f.number === Number(link.dataset.n));
    if (item) showFigure(p, item);
    else toast(`${link.textContent} couldn't be cut out of the PDF; it's in the paper itself.`);
  });
}

function editDetails(p, goals) {
  const header = app.querySelector("#header");
  header.innerHTML = `<form class="sheet form edit-form" id="edit-form">
    <label for="f-title">Title</label><input id="f-title" required value="${esc(p.title)}">
    <label for="f-authors">Authors</label><input id="f-authors" value="${esc(p.authors)}" placeholder="Comma-separated">
    <div class="edit-row">
      <div><label for="f-year">Year</label><input id="f-year" type="number" min="1600" max="2100" value="${p.year ?? ""}"></div>
      <div><label for="f-goal">Goal</label><select id="f-goal"><option value="">No goal</option>
        ${goals.map((g) => `<option value="${g.id}" ${g.id === p.topic_id ? "selected" : ""}>${esc(g.goal)}</option>`).join("")}</select></div>
    </div>
    <div class="form-foot"><button type="button" class="button quiet" id="f-cancel">Cancel</button><button class="button">Save</button></div>
  </form>`;
  header.querySelector("#f-cancel").onclick = () => paperPage(p.id, () => false);
  header.querySelector("#edit-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const year = header.querySelector("#f-year").value;
      const goal = header.querySelector("#f-goal").value;
      await api(`/papers/${p.id}`, { method: "PATCH", json: {
        title: header.querySelector("#f-title").value,
        authors: header.querySelector("#f-authors").value,
        year: year ? Number(year) : null,
        topic_id: goal ? Number(goal) : null,
      } });
      paperPage(p.id, () => false);
    });
  };
}

async function uploadPdf(id, file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  app.querySelectorAll(".pdf-input").forEach((input) => (input.closest("label").querySelector("span").textContent = "Uploading…"));
  try {
    await api(`/papers/${id}/pdf`, { method: "POST", body: form });
    forgetCover(id);
    location.hash = `#/papers/${id}/read`;
  } catch (e) { toast(e.message); }
}

async function loadRefs(box, p) {
  if (!p.external_id && !p.text) {
    box.innerHTML = `<p class="faint">Upload the PDF to see this paper's references.</p>`;
    return;
  }
  box.innerHTML = p.refs ? "" : (p.preparing ? preparingNote("its references") : loading("Loading references"));
  let refs;
  try { refs = await api(`/papers/${p.id}/references`); }
  catch (e) { if (box.isConnected) box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  if (!box.isConnected) return; // you went to another tab meanwhile
  box.innerHTML = refs.length ? `<p class="hint">Pick one to read next; the map remembers which paper led you where.</p>
    <div class="list">${refs.map((r, i) => `<div class="ref">
      <span><span class="ref-title">${esc(r.title)}</span><span class="result-cite">${cite(r)}</span></span>
      ${r.library_id ? `<a class="button quiet" href="#/papers/${r.library_id}">Open</a>`
        : `<button class="button secondary" data-ref="${i}">Read this</button>`}</div>`).join("")}</div>`
    : `<p class="faint">No references found.</p>`;
  box.onclick = (e) => {
    const b = e.target.closest("[data-ref]");
    if (b) busy(b, "Adding…", async () => {
      const added = await api("/papers", { method: "POST", json: { ...refs[b.dataset.ref], topic_id: p.topic_id, source_paper_id: p.id } });
      location.hash = `#/papers/${added.id}`;
    });
  };
}
