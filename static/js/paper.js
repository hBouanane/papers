import { api, apiStream, app, busy, cite, esc, setBar, knownWords, loading, markdown, pct, progressBar, quote, renderVocab, showShortcuts, statusTag, toast } from "./core.js";
import { cover, drawCovers, forgetCover } from "./covers.js";
import { drawPdf, drawPdfPage, drawText, pdfAnchor, textAnchor } from "./highlights.js";
import { COLORS, bindNotesList, noteStore } from "./notes.js";
import { openPdf } from "./pdfview.js";
import { bindReadingPrefs, pageToneControl, pdfPagesDark, readingPrefsMenu, setPageTone, toggleDarkPages } from "./readprefs.js";
import { canSpeak, speak, speaking, stopSpeaking } from "./speech.js";
import { renderPaperText } from "./textview.js";
import { SLICES, startTracker, stripBackground } from "./tracker.js";

const minutes = (text) => Math.max(1, Math.round((text || "").split(/\s+/).length / 230));

// ---------- Overview ----------
const TABS = [["overview", "Overview"], ["words", "Words"], ["notes", "Notes"], ["refs", "References"]];
const prepared = (p) => p.skim && p.glossary && p.quiz && p.refs;

export async function paperPage(id, stale, tab = "overview") {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [p, goals, chain, settings] = await Promise.all([api(`/papers/${id}`), api("/topics"), api(`/papers/${id}/chain`), api("/settings")]);
  if (stale()) return;
  const goal = goals.find((g) => g.id === p.topic_id);
  const readLabel = { new: "Start reading", skimmed: "Start reading", reading: `Continue reading`, read: "Read again" }[p.status];
  const ancestors = chain.path.slice(0, -1);
  const readable = p.text || p.has_pdf;
  setBar({ back: goal ? { href: `#/goals/${goal.id}`, label: goal.goal } : { href: "#/", label: "Library" }, title: p.title });

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
  const showTab = (key) => {
    tab = key;
    app.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === key));
    if (key === "overview") renderOverview(panel, p, settings);
    else if (key === "words") {
      if (!p.glossary && p.preparing) panel.innerHTML = preparingNote("the hard words");
      else renderVocab(panel, p);
    } else if (key === "notes") {
      panel.innerHTML = `<h2>Notes and highlights</h2><div id="overview-notes"></div>`;
      const store = noteStore(id);
      bindNotesList(panel.querySelector("#overview-notes"), store, {
        here: () => ({ position: p.position || 0 }),
        jump: (note) => {
          try { sessionStorage.setItem(`papers.jump.${id}`, note.id); } catch { /* opens at the last place instead */ }
          location.hash = `#/papers/${id}/read`;
        },
      });
      store.load().catch((e) => toast(e.message));
    } else loadRefs(panel, p);
  };
  app.querySelector(".tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) showTab(b.dataset.tab);
  };
  showTab(tab);

  // Claude reads the paper ahead of time; while it does, the tabs fill in as results arrive.
  if (settings.ai_ready && p.text && !prepared(p)) {
    if (!p.preparing) await api(`/papers/${id}/prepare`, { method: "POST" }).catch(() => {});
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
  <p>Claude is reading this paper and preparing ${what}. This takes a minute or two, once; you can start reading meanwhile.</p></div>`;

function renderOverview(box, p, settings) {
  const s = p.skim;
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const fold = (title, body, open = false) => body ? `<details class="fold"${open ? " open" : ""}><summary>${title}</summary>${body}</details>` : "";
  const abstract = p.abstract ? fold("Abstract", `<p class="fold-text">${esc(p.abstract)}</p>`, !s) : "";
  if (!s) {
    box.innerHTML = p.preparing ? `${preparingNote("its key points")}${abstract}`
      : settings.ai_ready && p.text ? `<h2>Key points</h2><p class="hint">A first pass on the paper in plain English, before you read it.</p>
          <button class="button" id="skim-btn">Get key points</button>${abstract}`
      : `<p class="hint">${p.text ? `Set up Claude in <a href="#/settings">Settings</a> to get key points, words and questions.`
          : "Upload the PDF to get key points."}</p>${abstract}`;
    box.querySelector("#skim-btn")?.addEventListener("click", (e) => busy(e.currentTarget, "Reading the paper…", async () => {
      p.skim = await api(`/papers/${p.id}/skim`, { method: "POST" });
      renderOverview(box, p, settings);
    }));
    return;
  }
  // Older key points have fewer fields; show what's there.
  box.innerHTML = `
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
    ${fold("Figures to look at", s.figures?.length ? list(s.figures) : "")}
    ${fold("Read closely", s.read_closely?.length ? list(s.read_closely) : "")}
    ${abstract}`;
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
  catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
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

// A short burst of sprinkles when you finish a paper.
export function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#1d3fbb", "#1d7a4e", "#e2b84b", "#b42318", "#8ea6ff"];
  const layer = document.createElement("div");
  layer.className = "sprinkles";
  layer.innerHTML = Array.from({ length: 90 }, () => {
    const x = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const duration = 1.6 + Math.random() * 1.2;
    const drift = (Math.random() - 0.5) * 200;
    const turn = Math.random() * 720 - 360;
    return `<i style="left:${x}vw;background:${colors[Math.floor(Math.random() * colors.length)]};
      animation-delay:${delay}s;animation-duration:${duration}s;--drift:${drift}px;--turn:${turn}deg"></i>`;
  }).join("");
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3500);
}

// ---------- Reader ----------
// Wraps the paper's hard words (not the ones you know) in an underline that shows their meaning.
let termPattern = null;
let termMeaning = {};
function prepareTerms(glossary) {
  const known = knownWords();
  const words = (glossary || []).filter((w) => !known.has(w.term.toLowerCase()));
  termMeaning = Object.fromEntries(words.map((w) => [w.term.toLowerCase(), w.meaning]));
  const escaped = words.map((w) => esc(w.term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  termPattern = escaped.length ? new RegExp(`\\b(${escaped.join("|")})\\b`, "gi") : null;
}
// `seen` holds the words already underlined in this section, so each is marked once per section.
function markTerms(html, seen = new Set()) {
  if (!termPattern) return html;
  return html.replace(termPattern, (m) => {
    const key = m.toLowerCase();
    if (seen.has(key)) return m;
    seen.add(key);
    return `<abbr class="term" title="${esc(termMeaning[key] || "")}">${m}</abbr>`;
  });
}

const ZOOM_KEY = "papers.pdfZoom";
const savedZoom = () => { try { return Number(localStorage.getItem(ZOOM_KEY)) || 1; } catch { return 1; } };
const saveZoom = (z) => { try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* not remembered */ } };

export async function readerPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  let p = await api(`/papers/${id}`);
  if (stale()) return;
  if (p.can_fetch_pdf) {
    app.innerHTML = `<div class="container page">${loading("Getting the original PDF (only the first time)")}</div>`;
    try { p = await api(`/papers/${id}/fetch-pdf`, { method: "POST" }); }
    catch (e) { toast(`Couldn't get the original PDF, showing the text instead. ${e.message}`); }
    if (stale()) return;
  }
  if (!p.text && !p.has_pdf) { location.replace(`#/papers/${id}`); return; }
  // The original PDF is the default; small screens get the reflowed text when there is some.
  let view = p.has_pdf && (innerWidth >= 700 || !p.text) ? "pdf" : "text";
  let saved = p.position; // where you stopped, as the server knows it
  const { language } = await api("/settings").catch(() => ({ language: "" }));
  if (stale()) return;
  document.body.classList.add("reading");

  app.innerHTML = `
    <div class="reader-bar" id="bar">
      <div class="reader-bar-inner">
        <a href="#/papers/${id}" class="reader-back" title="Back to paper overview"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(p.title)}</span></a>
        ${p.has_pdf && p.text ? `<div class="segmented small" role="group" aria-label="View" id="views">
          <button data-view="pdf">Original</button><button data-view="text">Text</button></div>` : ""}
        <select id="jump" class="jump" aria-label="Go to a section or page"><option value="">Go to…</option></select>
        <div class="zoom" id="zoom" role="group" aria-label="Zoom" hidden>
          <button class="button quiet small" data-zoom="out" title="Zoom out (−)">−</button>
          <button class="button quiet small zoom-value num" data-zoom="fit" title="Fit to width">100%</button>
          <button class="button quiet small" data-zoom="in" title="Zoom in (+)">+</button></div>
        ${readingPrefsMenu()}
        <button class="switch" id="skim" role="switch" aria-checked="false" title="Skim freely: nothing you do counts as reading (s)"><span class="switch-track" aria-hidden="true"></span>Skimming</button>
        ${pageToneControl()}
        <span class="reader-pct num" id="pct" title="How much you've actually read. Fast scrolling and jumps don't count."></span>
        <button class="button secondary small" id="toggle-notes" title="Ask Claude, words, your notes (n)">Ask &amp; notes</button>
      </div>
      <div class="strip" id="strip" title="Parts you've read. Click to jump."><span class="strip-view" id="strip-view"></span></div>
    </div>
    <div class="reader-scroll" id="scroller"></div>
    <aside class="notes" id="notes" aria-label="Ask, words and notes">
      <div class="panel-head">
        <div class="panel-tabs" role="tablist">
          <button role="tab" data-pane="ask" aria-selected="true">Ask</button>
          <button role="tab" data-pane="words" aria-selected="false">Words</button>
          <button role="tab" data-pane="notes" aria-selected="false">Notes</button>
        </div>
        <button class="button quiet small" id="close-notes" title="Close (n)">Close</button>
      </div>
      <div class="pane pane-ask" data-pane="ask">
        <div class="thread" id="thread">
          <div class="thread-empty">
            <p><strong>Select any text in the paper</strong> to explain, simplify, translate or hear it.</p>
            <p>Or ask anything below. Claude answers with the whole paper in mind.</p>
          </div>
        </div>
        <form id="ask" class="composer">
          <textarea id="question" rows="2" placeholder="Ask anything about this paper…"></textarea>
          <button class="button small">Ask</button>
        </form>
      </div>
      <div class="pane" data-pane="words" hidden><div id="reader-vocab" class="reader-vocab"></div></div>
      <div class="pane" data-pane="notes" hidden><div id="notes-list"></div></div>
    </aside>
    <div class="finish-card sheet" id="finish-card" role="dialog" aria-live="polite" hidden></div>
    <div class="sel-bar" id="pop" role="toolbar" aria-label="Selected text" hidden>
      <span class="sel-colors" role="group" aria-label="Highlight">${COLORS.map((c, i) =>
        `<button data-sel="highlight" data-color="${c}" class="sel-dot" title="Highlight${i ? "" : " (h)"}" aria-label="Highlight ${c}"><span class="hl-dot hl-${c}"></span></button>`).join("")}</span>
      <button data-sel="note" title="Highlight it and write a note">Note</button>
      <button data-sel="explain" title="Explain it with the whole paper in mind (e)">Explain</button>
      <button data-sel="simplify" title="Rewrite it in simple English">Simplify</button>
      <button data-sel="translate" title="${language ? `Translate into ${esc(language)}` : "Set your language in Settings to translate"}">Translate</button>
      ${canSpeak() ? `<button data-sel="listen" title="Hear it read aloud (l)">Listen</button>` : ""}
      <button data-sel="word" title="Add this word to the paper's vocabulary">Save word</button>
    </div>`;

  const $ = (sel) => app.querySelector(sel);
  // The paper scrolls in this panel (both views), below the reader bar.
  const scroller = $("#scroller");
  const pop = $("#pop");
  // The side panel: Ask, Words or Notes, one at a time.
  const setOpen = (open, pane) => {
    document.body.classList.toggle("notes-open", open);
    if (!pane) return;
    app.querySelectorAll(".panel-tabs [data-pane]").forEach((b) => b.setAttribute("aria-selected", b.dataset.pane === pane));
    app.querySelectorAll(".pane").forEach((el) => (el.hidden = el.dataset.pane !== pane));
    if (pane === "ask") setTimeout(() => $("#thread").scrollTo(0, $("#thread").scrollHeight));
  };
  const placeScroller = () => document.body.style.setProperty("--reader-top", `${$("#bar").offsetHeight}px`);
  const barObserver = new ResizeObserver(placeScroller);
  barObserver.observe($("#bar"));
  placeScroller();
  const maxScroll = () => Math.max(1, scroller.scrollHeight - scroller.clientHeight);
  const positionNow = () => Math.min(1, Math.max(0, scroller.scrollTop / maxScroll()));
  const scrollToPosition = (position) => (scroller.scrollTop = position * maxScroll());
  const scrollToElement = (el) =>
    (scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16);
  const endBox = `<div class="article-end">${p.status === "read"
    ? `<p>You've finished this paper.</p>${p.quiz?.length ? `<a class="button secondary" href="#/papers/${id}/quiz">Test yourself</a>` : ""}`
    : `<p>That's the end of the paper.</p><button class="button" data-finish>Mark as finished</button>`}</div>`;
  let pdf = null;
  let targets = []; // "Go to…" destinations for the current view: { label, go, page? }

  // Your notes and highlights: the list in the side panel and the marks on the paper.
  const notes = noteStore(id);
  const drawMarks = () => (view === "text" ? drawText(scroller.querySelector("#article"), notes.items) : drawPdf(scroller, notes.items));
  notes.on(drawMarks);

  // While a view (re)opens the page is briefly short or empty; that must not count as reaching the end.
  let settling = false;
  const show = async (next) => {
    settling = true;
    view = next;
    pdf?.close();
    pdf = null;
    app.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    scroller.className = `reader-scroll view-${view}`;
    if (view === "text") {
      prepareTerms(p.glossary);
      const { html, headings } = renderPaperText(p, markTerms);
      scroller.innerHTML = `<article class="page-sheet" id="article">${html}${endBox}</article>`;
      targets = headings.map((h) => ({
        label: `${h.level === 3 ? "  " : ""}${h.label}`, go: () => scrollToElement(scroller.querySelector(`#${h.id}`)),
      }));
    } else {
      scroller.innerHTML = loading("Opening the PDF");
      try {
        pdf = await openPdf(`/api/papers/${id}/file`, scroller,
          { zoom: savedZoom(), after: endBox, dark: pdfPagesDark() });
        pdf.onZoom((zoom) => {
          $("#zoom .zoom-value").textContent = pct(zoom);
          saveZoom(zoom);
          paintView();
        });
        targets = [
          ...pdf.outline.map((o) => ({ label: `${o.depth ? "  " : ""}${o.title}`, go: () => pdf.goTo(o.dest) })),
          ...Array.from({ length: pdf.pageCount }, (_, i) => ({ label: `Page ${i + 1} of ${pdf.pageCount}`, go: () => pdf.goToPage(i + 1), page: true })),
        ];
      } catch (e) {
        scroller.innerHTML = `<p class="error pad">Couldn't open the PDF: ${esc(e.message)}</p>`;
        targets = [];
      }
    }
    const sections = targets.filter((t) => !t.page);
    const pages = targets.filter((t) => t.page);
    $("#jump").innerHTML = `<option value="">Go to…</option>
      ${sections.length ? `<optgroup label="Sections">${sections.map((t) => `<option value="${targets.indexOf(t)}">${esc(t.label)}</option>`).join("")}</optgroup>` : ""}
      ${pages.length ? `<optgroup label="Pages">${pages.map((t) => `<option value="${targets.indexOf(t)}">${esc(t.label)}</option>`).join("")}</optgroup>` : ""}`;
    $("#jump").hidden = !targets.length;
    $("#zoom").hidden = !pdf;
    $("#page-tone").hidden = view !== "pdf";
    if (pdf) $("#zoom .zoom-value").textContent = pct(pdf.zoom);
    if (pdf) pdf.onPageRendered((n, div) => drawPdfPage(div, n, notes.items));
    drawMarks();
    setTimeout(() => (settling = false), 800); // callers put you back where you were in the meantime
  };

  // Open the paper, then go back to where the reader stopped.
  await show(view);
  if (stale()) { pdf?.close(); barObserver.disconnect(); return; }
  let jumpTo = null;
  try { jumpTo = Number(sessionStorage.getItem(`papers.jump.${id}`)) || null; sessionStorage.removeItem(`papers.jump.${id}`); } catch { /* none */ }
  if (saved > 0.01 && saved < 0.99 && !jumpTo) {
    scrollToPosition(saved);
    toast(`Back where you stopped, ${pct(saved)} in`);
  }
  const notesUi = bindNotesList($("#notes-list"), notes, {
    here: () => ({ position: positionNow(), page: pdf ? pdf.page : null }),
    jump: (note) => jumpToNote(note),
  });
  notes.load().then(() => {
    const note = jumpTo && notes.items.find((n) => n.id === jumpTo);
    if (note) { jumpToNote(note); setOpen(true, "notes"); }
  }).catch((e) => toast(e.message));

  // ----- Tracking -----
  const words = p.text ? p.text.split(/\s+/).length : (pdf?.pageCount || 10) * 400;
  const tracker = startTracker({ scroller, paper: p, words, onRead: () => paintStrip() });
  // Papers tracked the old way keep their percentage until real reading overtakes it (same rule as the server).
  const legacy = p.read_slices ? 0 : p.progress;
  const paintStrip = () => {
    const read = Math.max(legacy, tracker.bits.filter((b) => b === "1").length / SLICES);
    $("#strip").style.background = stripBackground(tracker.bits);
    $("#pct").textContent = tracker.mode === "skim" ? "Skimming, not counted" : `${pct(read)} read`;
  };
  // Skimming: jump around freely; nothing counts until you switch it off.
  const setSkimming = (on) => {
    flush();
    tracker.setMode(on ? "skim" : "read");
    $("#skim").setAttribute("aria-checked", on);
    document.body.classList.toggle("skimming", on);
    paintStrip();
    if (on && p.status === "new") {
      p.status = "skimmed";
      api(`/papers/${id}/progress`, { method: "PUT", json: { position: saved, mode: "skim" } }).catch(() => {});
    }
  };
  $("#skim").onclick = () => setSkimming(tracker.mode !== "skim");
  $("#page-tone").onclick = (e) => { const b = e.target.closest("[data-pages]"); if (b) setPageTone(b.dataset.pages); };
  const paintView = () => {
    const height = Math.max(1, scroller.scrollHeight);
    const marker = $("#strip-view");
    marker.style.left = pct(scroller.scrollTop / height);
    marker.style.width = pct(Math.min(1, scroller.clientHeight / height));
  };
  paintStrip();
  paintView();

  const flush = (keepalive = false) => {
    const update = tracker.take();
    if (!update) return;
    if (update.position !== null) saved = update.position;
    const body = JSON.stringify({ position: saved, slices: update.slices });
    fetch(`/api/papers/${id}/progress`, { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive }).catch(() => {});
  };
  const flushTimer = setInterval(flush, 4000);
  const onHide = () => flush(true);
  addEventListener("pagehide", onHide);

  scroller.addEventListener("scroll", () => { paintView(); pop.hidden = true; checkFinished(); }, { passive: true });

  $("#strip").onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    scroller.scrollTop = ((e.clientX - r.left) / r.width) * scroller.scrollHeight - scroller.clientHeight / 3;
  };
  $("#jump").onchange = (e) => {
    targets[e.target.value]?.go();
    e.target.value = "";
  };
  $("#views")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-view]");
    if (!b || b.dataset.view === view) return;
    const position = positionNow();
    await show(b.dataset.view);
    scrollToPosition(position);
  });

  // ----- Explanations -----
  // The Ask tab is a conversation: what you asked (or selected), then Claude's answer.
  const ACTION = { explain: "Explain", simplify: "Simplify", translate: "Translate" };
  const turnHtml = (e) => `<div class="msg msg-you">
      ${e.passage ? `<span class="msg-action">${ACTION[e.mode] || "Explain"}</span>${quote(e.passage)}` : ""}
      ${e.question ? `<p>${esc(e.question)}</p>` : ""}</div>
    <div class="msg msg-claude">${e.answer ? markdown(e.answer) : e.error ? `<p class="error">${esc(e.error)}</p>` : `<p class="typing">Thinking…</p>`}
      ${e.answer && canSpeak() ? `<button class="link-button msg-listen">Listen</button>` : ""}</div>`;
  const thread = $("#thread");
  const toBottom = () => (thread.scrollTop = thread.scrollHeight);
  const addTurn = (e) => {
    thread.querySelector(".thread-empty")?.remove();
    const turn = document.createElement("div");
    turn.className = "turn";
    turn.innerHTML = turnHtml(e);
    thread.append(turn);
    toBottom();
    return turn;
  };
  // The answer appears as Claude writes it (redrawn every few dozen milliseconds), with a caret while it's coming.
  const explain = async (passage, question = "", mode = "explain") => {
    setOpen(true, "ask");
    const turn = addTurn({ passage, question, mode });
    const answer = turn.querySelector(".msg-claude");
    let text = "";
    let queued = false;
    const paint = () => {
      queued = false;
      const follow = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; // don't pull you down if you scrolled up
      answer.innerHTML = markdown(text);
      (answer.lastElementChild || answer).insertAdjacentHTML("beforeend", `<span class="caret" aria-hidden="true"></span>`);
      if (follow) toBottom();
    };
    try {
      text = await apiStream(`/papers/${id}/explain/stream`, { passage, question, mode }, (_, sofar) => {
        text = sofar;
        if (!queued) { queued = true; setTimeout(paint, 40); } // at most ~25 redraws a second
      });
      turn.innerHTML = turnHtml({ passage, question, mode, answer: text });
    } catch (err) {
      turn.innerHTML = turnHtml({ passage, question, mode, answer: text, error: text ? "" : err.message });
      if (text) turn.querySelector(".msg-claude").insertAdjacentHTML("beforeend", `<p class="error">${esc(err.message)}</p>`);
    }
    toBottom();
  };
  thread.addEventListener("click", (e) => {
    const listen = e.target.closest(".msg-listen");
    if (listen) speaking() ? stopSpeaking() : speak(listen.closest(".msg").innerText.replace(/Listen$/, ""));
  });

  // Earlier questions for this paper, oldest first, like a conversation.
  api(`/papers/${id}/explanations`).then((items) => {
    items.reverse().forEach((e) => addTurn(e));
  }).catch(() => {});

  // Mark explained passages in the reflowed text; the PDF text layer is absolutely positioned, so leave it alone.
  const highlight = (range) => {
    if (view !== "text") return;
    try {
      const mark = document.createElement("mark");
      mark.className = "explained";
      range.surroundContents(mark);
    } catch { /* selection spans paragraphs; skip the inline highlight */ }
  };

  // Select text in the paper to explain, simplify, translate, hear or save it.
  let selection = null; // { text, range, sentence }
  const sentenceAround = (range) => {
    const block = range.startContainer.parentElement?.closest("p, li, .textLayer");
    const all = (block?.textContent || "").replace(/\s+/g, " ");
    const at = all.indexOf(range.toString().trim().split(/\s+/)[0]);
    if (at < 0) return range.toString();
    const start = Math.max(all.lastIndexOf(". ", at) + 2, 0);
    const end = all.indexOf(". ", at);
    return all.slice(start, end < 0 ? undefined : end + 1).slice(0, 400);
  };
  const showSelectionBar = () => {
    const sel = getSelection();
    const text = sel.toString().trim();
    if (text.length < 2 || !sel.rangeCount || !scroller.contains(sel.anchorNode)) { pop.hidden = true; selection = null; return; }
    const range = sel.getRangeAt(0);
    selection = { text, range: range.cloneRange(), sentence: sentenceAround(range) };
    pop.querySelector("[data-sel=word]").hidden = text.split(/\s+/).length > 4;
    pop.hidden = false;
    const rect = range.getBoundingClientRect();
    const width = pop.offsetWidth;
    const top = scroller.getBoundingClientRect().top;
    pop.style.top = `${Math.max(rect.top - pop.offsetHeight - 10, top + 6)}px`;
    pop.style.left = `${Math.min(innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))}px`;
  };
  scroller.addEventListener("mouseup", () => setTimeout(showSelectionBar));
  scroller.addEventListener("keyup", (e) => e.shiftKey && setTimeout(showSelectionBar));
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection while clicking
  pop.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-sel]")?.dataset.sel;
    if (!action || !selection) return;
    const { text, range, sentence } = selection;
    if (action === "listen") {
      if (speaking()) return stopSpeaking();
      const button = e.target.closest("button");
      button.textContent = "Stop";
      return speak(text, { onEnd: () => (button.textContent = "Listen") });
    }
    pop.hidden = true;
    getSelection().removeAllRanges();
    if (action === "highlight" || action === "note") {
      const note = await addHighlight(range, text, action === "note" ? "yellow" : e.target.closest("[data-color]").dataset.color);
      if (note && action === "note") { setOpen(true, "notes"); notesUi.edit(note.id); }
      return;
    }
    if (action === "word") {
      toast(`Adding "${text}" to the vocabulary…`);
      try {
        p.glossary = await api(`/papers/${id}/words`, { method: "POST", json: { term: text, context: sentence } });
        renderVocab($("#reader-vocab"), p, { compact: true });
        const w = p.glossary.find((x) => x.term.toLowerCase() === text.toLowerCase());
        setOpen(true, "words");
        toast(w ? `${w.term}: ${w.meaning}` : "Added.");
      } catch (err) { toast(err.message); }
      return;
    }
    if (action === "translate" && !language) return toast("Set your language in Settings first, then Translate works.");
    highlight(range);
    explain(text, "", action);
  });

  const addHighlight = async (range, text, color) => {
    const box = range.getBoundingClientRect();
    const y = scroller.scrollTop + box.top - scroller.getBoundingClientRect().top - 120;
    const position = Math.min(1, Math.max(0, y / maxScroll()));
    let anchor = null;
    if (view === "pdf") {
      anchor = pdfAnchor(range, scroller);
      if (!anchor) return toast("Couldn't place that highlight on the page.");
    } else anchor = textAnchor(scroller.querySelector("#article"), range);
    try {
      return await notes.add({ kind: "highlight", quote: text, color, position, page: anchor.rects?.[0]?.[0] ?? null, anchor });
    } catch (err) { toast(err.message); }
  };
  // Go to a note: its exact spot when it's drawn in this view, otherwise its page or its place in the paper.
  const jumpToNote = (note) => {
    const mark = scroller.querySelector(`[data-note="${note.id}"]`);
    const rect = note.anchor?.rects?.[0];
    if (view === "pdf" && rect) pdf.showPoint(rect[0], rect[2]);
    else if (mark && view === "text") scrollToElement(mark);
    else if (view === "pdf" && note.page) pdf.goToPage(note.page);
    else scrollToPosition(note.position);
    const flash = () => scroller.querySelectorAll(`[data-note="${note.id}"]`).forEach((m) => {
      m.classList.remove("flash"); void m.offsetWidth; m.classList.add("flash");
    });
    setTimeout(flash, 120);
  };

  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    const question = $("#question").value.trim();
    if (!question) return $("#question").focus();
    explain("", question);
    $("#question").value = "";
  };
  $("#question").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ask").requestSubmit(); }
  });
  app.querySelector(".panel-tabs").onclick = (e) => {
    const b = e.target.closest("[data-pane]");
    if (b) setOpen(true, b.dataset.pane);
  };
  $("#toggle-notes").onclick = () => setOpen(!document.body.classList.contains("notes-open"));
  $("#close-notes").onclick = () => setOpen(false);

  // ----- Finishing: asked once you reach the end of the main text (before the references),
  // and again at the very end if you said "not yet". -----
  const card = $("#finish-card");
  let asked = 0; // 0: not yet asked, 1: asked at the end of the main text, 2: asked at the very end
  const mainEndReached = () => {
    const refs = view === "text" && [...scroller.querySelectorAll(".section-head")].find((h) => /references|bibliography/i.test(h.textContent));
    const bottom = scroller.scrollTop + scroller.clientHeight;
    if (refs) return refs.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom - 40;
    return bottom >= scroller.scrollHeight * Math.min(p.main_end, 0.98);
  };
  const atVeryEnd = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40;
  // Only your own scrolling counts, not the jump back to where you stopped.
  let movedByYou = false;
  ["wheel", "touchmove", "keydown", "pointerdown"].forEach((type) =>
    scroller.addEventListener(type, () => (movedByYou = true), { passive: true, once: true }));
  addEventListener("keydown", () => (movedByYou = true), { once: true });
  const checkFinished = () => {
    if (!movedByYou || settling || p.status === "read" || !card.hidden) return;
    if ((asked === 0 && mainEndReached()) || (asked === 1 && atVeryEnd())) {
      asked += 1;
      askFinished();
    }
  };
  const askFinished = () => {
    card.innerHTML = `<p class="finish-q">Did you finish reading this paper?</p>
      <div class="finish-actions"><button class="button" data-finish>Yes, I finished</button>
      <button class="button quiet" id="not-yet">Not yet</button></div>`;
    card.hidden = false;
    card.querySelector("#not-yet").onclick = () => (card.hidden = true);
  };
  const finish = (button) => busy(button, "Saving…", async () => {
    flush();
    const done = await api(`/papers/${id}/finish`, { method: "POST" });
    p.status = "read";
    celebrate();
    $("#pct").textContent = "100% read";
    card.innerHTML = `<p class="finish-q">Nice work, that's another paper read.</p>
      <p class="hint">${done.quiz?.length ? "A few review questions are ready whenever you want to check what stuck." : "It's marked as read."}</p>
      <div class="finish-actions">${done.quiz?.length ? `<a class="button" href="#/papers/${id}/quiz">Test yourself</a>` : ""}
      <button class="button quiet" id="keep-reading">Keep reading</button></div>`;
    card.hidden = false;
    card.querySelector("#keep-reading").onclick = () => (card.hidden = true);
    scroller.querySelector(".article-end")?.replaceChildren(Object.assign(document.createElement("p"), { textContent: "You've finished this paper." }));
  });
  card.addEventListener("click", (e) => { const b = e.target.closest("[data-finish]"); if (b) finish(b); });

  renderVocab($("#reader-vocab"), p, { compact: true });
  scroller.addEventListener("click", (e) => {
    if (e.target.closest("[data-finish]")) return finish(e.target.closest("[data-finish]"));
    // Tap or click an underlined word to see what it means (hover works too on a computer).
    const term = e.target.closest(".term");
    if (term && !getSelection().toString()) toast(`${term.textContent}: ${term.title}`);
  });
  // A newly generated vocabulary or a word marked as known changes the underlines in Text view.
  const refreshTerms = () => {
    const position = positionNow();
    show("text").then(() => scrollToPosition(position));
  };
  $("#reader-vocab").addEventListener("click", () => setTimeout(() => view === "text" && refreshTerms(), 0));
  $("#reader-vocab").addEventListener("known-changed", () => view === "text" && refreshTerms());

  // ----- Zoom (PDF): around the cursor for Ctrl + wheel / pinch, around the middle otherwise -----
  const middle = () => {
    const r = scroller.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  $("#zoom").onclick = (e) => {
    const z = e.target.closest("[data-zoom]")?.dataset.zoom;
    if (!pdf || !z) return;
    if (z === "fit") pdf.fitWidth();
    else pdf.zoomBy(z === "in" ? 1.25 : 0.8, middle());
  };
  // Trackpad pinches arrive as Ctrl + wheel too; small deltas give small, smooth steps.
  scroller.addEventListener("wheel", (e) => {
    if (!pdf || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY / 300)));
    pdf.zoomBy(factor, [e.clientX, e.clientY], { smooth: true });
  }, { passive: false });

  // Keyboard: s = skim/read, n = notes panel, e = explain, l = listen, +/- = zoom, ? = help.
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "s") setSkimming(tracker.mode !== "skim");
    else if (e.key === "n") setOpen(!document.body.classList.contains("notes-open"));
    else if (e.key === "e" && !pop.hidden) pop.querySelector("[data-sel=explain]").click();
    else if (e.key === "l" && !pop.hidden) pop.querySelector("[data-sel=listen]")?.click();
    else if (e.key === "h" && !pop.hidden) pop.querySelector("[data-sel=highlight]").click();
    else if ((e.key === "+" || e.key === "=") && pdf) pdf.zoomBy(1.25, middle());
    else if (e.key === "-" && pdf) pdf.zoomBy(0.8, middle());
    else if (e.key === "d" && pdf) toast(toggleDarkPages() ? "Dark pages on (press d to turn off)." : "Dark pages off.");
    else if (e.key === "?") showShortcuts([["s", "Skimming on or off (nothing counts while it's on)"], ["d", "Dark PDF pages on or off"], ["n", "Open or close Ask, Words and Notes"],
      ["e", "Explain the selected text"], ["h", "Highlight the selected text"], ["l", "Listen to the selected text"], ["+ −", "Zoom the PDF (or Ctrl + mouse wheel, or pinch)"]]);
    else return;
    e.preventDefault();
  };
  addEventListener("keydown", onKey);
  bindReadingPrefs($("#bar"));
  // Switching dark pages reopens the PDF where you are.
  const onDarkPages = async () => {
    if (view !== "pdf") return;
    const position = positionNow();
    await show("pdf");
    scrollToPosition(position);
  };
  document.addEventListener("dark-pages-changed", onDarkPages);

  return () => {
    stopSpeaking();
    removeEventListener("keydown", onKey);
    notesUi.destroy();
    document.removeEventListener("dark-pages-changed", onDarkPages);
    flush(true);
    tracker.stop();
    clearInterval(flushTimer);
    barObserver.disconnect();
    removeEventListener("pagehide", onHide);
    pdf?.close();
    document.body.classList.remove("notes-open", "skimming");
    document.body.style.removeProperty("--reader-top");
  };
}

// ---------- Review (flashcards) ----------
const RATINGS = [[1, "Got it"], [0.5, "Partly"], [0, "Missed it"]];

export async function quizPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const p = await api(`/papers/${id}`);
  if (stale()) return;
  setBar({ back: { href: `#/papers/${id}`, label: p.title }, title: p.title });
  const crumbs = "";

  if (!p.quiz?.length) {
    app.innerHTML = `<div class="container page narrow">${crumbs}
      <div class="page-head"><h1>Test yourself</h1></div>
      <div class="empty"><p>No questions for this paper yet. Claude writes them from the paper.</p>
        <button class="button" id="gen">Write questions</button></div></div>`;
    app.querySelector("#gen").onclick = (e) => busy(e.currentTarget, "Writing questions…", async () => {
      await api(`/papers/${id}/quiz`, { method: "POST" });
      quizPage(id, stale);
    });
    return;
  }

  const ratings = [];
  let revealed = false;
  const card = () => {
    const i = ratings.length;
    if (i === p.quiz.length) return finish();
    const q = p.quiz[i];
    revealed = false;
    app.innerHTML = `<div class="container page narrow">${crumbs}
      <p class="card-count">Card ${i + 1} of ${p.quiz.length}</p>
      <div class="sheet flashcard">
        <p class="card-question">${esc(q.question)}</p>
        <div id="answer" hidden><p class="card-answer">${esc(q.answer)}</p></div>
      </div>
      <div class="card-actions" id="actions">
        <button class="button" id="reveal">Show answer <kbd>Space</kbd></button>
      </div>
      <p class="card-alt">Think of your answer, then reveal it and rate yourself honestly.
        Prefer to write? <button class="link-button" id="typed">Type answers for Claude to grade</button></p>
    </div>`;
    app.querySelector("#reveal").onclick = reveal;
    app.querySelector("#typed").onclick = () => typedQuiz(p, crumbs);
  };
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    app.querySelector("#answer").hidden = false;
    app.querySelector("#actions").innerHTML = RATINGS.map(([value, label], k) =>
      `<button class="button ${k ? "secondary" : ""}" data-rate="${value}">${label} <kbd>${k + 1}</kbd></button>`).join("");
    app.querySelector("#actions").onclick = (e) => {
      const b = e.target.closest("[data-rate]");
      if (b) rate(Number(b.dataset.rate));
    };
  };
  const rate = (value) => { ratings.push(value); card(); };
  const finish = async () => {
    removeEventListener("keydown", onKey);
    app.innerHTML = `<div class="container page narrow">${crumbs}${loading("Saving")}</div>`;
    try {
      const done = await api(`/papers/${id}/review`, { method: "POST", json: { ratings } });
      const days = Math.round((new Date(done.review_due) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
      app.innerHTML = `<div class="container page narrow">${crumbs}
        <div class="sheet flashcard done">
          <p class="card-question">You knew ${ratings.filter((r) => r === 1).length} of ${ratings.length}${ratings.includes(0.5) ? `, partly ${ratings.filter((r) => r === 0.5).length} more` : ""}.</p>
          <p class="card-answer">Next review in ${days} day${days === 1 ? "" : "s"}. The Library will remind you.</p>
        </div>
        <div class="card-actions"><a class="button" href="#/">Back to library</a><a class="button secondary" href="#/papers/${id}">Paper</a></div>
      </div>`;
    } catch (e) { toast(e.message); }
  };
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea")) return;
    if (e.key === " " && !revealed) { e.preventDefault(); reveal(); }
    else if (revealed && ["1", "2", "3"].includes(e.key)) rate(RATINGS[Number(e.key) - 1][0]);
  };
  addEventListener("keydown", onKey);
  card();
  return () => removeEventListener("keydown", onKey);
}

function typedQuiz(p, crumbs) {
  app.innerHTML = `<div class="container page narrow">${crumbs}
    <div class="page-head"><h1>Test yourself</h1>
    <p class="lede">Answer in your own words. Claude grades each answer against the paper, not against exact wording.</p></div>
    <form id="quiz" class="quiz">${p.quiz.map((q, i) => `<div class="sheet question">
      <label for="a${i}"><span class="q-num">Question ${i + 1} of ${p.quiz.length}</span>${esc(q.question)}</label>
      <textarea id="a${i}" rows="3"></textarea>
      <div class="feedback" id="fb${i}"></div></div>`).join("")}
      <div class="quiz-foot"><button class="button">Grade my answers</button><span id="score" class="score"></span></div>
    </form></div>`;

  app.querySelector("#quiz").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Grading…", async () => {
      const answers = p.quiz.map((_, i) => app.querySelector(`#a${i}`).value);
      const r = await api(`/papers/${p.id}/quiz/grade`, { method: "POST", json: { answers } });
      r.results.forEach((res, i) => {
        const level = res.score >= 0.8 ? "good" : res.score >= 0.4 ? "partial" : "miss";
        app.querySelector(`#fb${i}`).innerHTML = `<p class="grade"><span class="score-pill score-${level} num">${pct(res.score)}</span><span>${esc(res.feedback)}</span></p>
          <details><summary>Reference answer</summary><p>${esc(p.quiz[i].answer)}</p></details>`;
      });
      app.querySelector("#score").innerHTML = `You understood <strong class="num">${pct(r.score)}</strong> of this paper`;
    });
  };
}
