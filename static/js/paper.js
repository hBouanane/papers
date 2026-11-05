import { api, app, bindNotes, busy, cite, esc, knownWords, loading, markdown, notesBox, pct, progressBar, quote, renderVocab, showShortcuts, statusTag, toast } from "./core.js";
import { renderPdf } from "./pdfview.js";
import { bindReadingPrefs, readingPrefsMenu } from "./readprefs.js";
import { canSpeak, speak, speaking, stopSpeaking } from "./speech.js";
import { renderPaperText } from "./textview.js";
import { SLICES, startTracker, stripBackground } from "./tracker.js";

const minutes = (text) => Math.max(1, Math.round((text || "").split(/\s+/).length / 230));

// ---------- Overview ----------
export async function paperPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [p, goals, chain] = await Promise.all([api(`/papers/${id}`), api("/topics"), api(`/papers/${id}/chain`)]);
  if (stale()) return;
  const goal = goals.find((g) => g.id === p.topic_id);
  const readLabel = { new: "Start reading", skimmed: "Start reading", reading: `Continue at ${pct(p.position)}`, read: "Read again" }[p.status];
  const ancestors = chain.path.slice(0, -1);
  const readable = p.text || p.has_pdf;

  app.innerHTML = `<div class="container page">
    <nav class="crumbs">${goal ? `<a href="#/goals">Goals</a><span>/</span><a href="#/goals/${goal.id}">${esc(goal.goal)}</a>` : `<a href="#/">Library</a>`}</nav>
    <header class="paper-header" id="header">
      <h1 class="paper-name paper-h1">${esc(p.title)}</h1>
      ${p.authors || p.year ? `<p class="paper-cite">${esc(p.authors)}${p.year ? ` (${p.year})` : ""}</p>` : ""}
      <div class="actions">
        ${readable ? `<a class="button" href="#/papers/${id}/read">${readLabel}</a>`
          : `<label class="button"><span>Upload the PDF</span><input type="file" class="pdf-input" accept="application/pdf,.pdf" hidden></label>`}
        ${p.quiz?.length ? `<a class="button secondary" href="#/papers/${id}/quiz">${p.understanding == null ? "Test yourself" : "Review"}</a>` : ""}
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
        but skimming, explanations and the quiz need text.</p>` : ""}
    </header>

    <div class="paper-layout">
      <div class="paper-main">
        ${p.abstract ? `<section class="sheet pad-lg abstract"><h2>Abstract</h2><p>${esc(p.abstract)}</p></section>` : ""}
        <section class="sheet pad-lg my-notes-section"><h2>My notes</h2>${notesBox(p, 4)}</section>
        <section class="sheet pad-lg" id="skim"></section>
        <section class="sheet pad-lg vocab-section" id="vocab"></section>
        <section class="section">
          <div class="section-bar">
            <h2>References</h2>
            ${p.external_id || p.text ? `<button class="button secondary" id="refs-btn">Show references</button>` : ""}
          </div>
          <div id="refs"><p class="faint">${p.external_id || p.text
            ? "Follow a reference to go deeper. The map remembers which paper led you where."
            : "Upload the PDF to see this paper's references."}</p></div>
        </section>
      </div>

      <aside class="paper-side">
        <div class="sheet facts">
          <div><span>Status</span>${statusTag(p)}</div>
          <div><span>Read</span><span class="fact-bar">${progressBar(p)}<span class="num">${pct(p.progress)}</span></span></div>
          ${p.status === "reading" ? `<div><span>Stopped at</span><span class="num">${pct(p.position)}</span></div>` : ""}
          <div><span>Understood</span><span class="num">${p.understanding == null ? `<span class="faint">Not tested</span>` : pct(p.understanding)}</span></div>
          ${p.text ? `<div><span>Length</span><span>${minutes(p.text)} min</span></div>` : ""}
        </div>
        ${ancestors.length ? `<div class="sheet trail"><h3>Found through</h3>
          ${ancestors.map((a) => `<a href="#/papers/${a.id}">${esc(a.title)}</a>`).join("")}</div>` : ""}
        ${chain.children.length ? `<div class="sheet trail"><h3>Led you to</h3>
          ${chain.children.map((c) => `<a href="#/papers/${c.id}">${esc(c.title)}</a>`).join("")}</div>` : ""}
      </aside>
    </div></div>`;

  renderSkim(p);
  renderVocab(app.querySelector("#vocab"), p);
  bindNotes(p);
  const menu = app.querySelector(".menu");
  app.querySelector("#edit").onclick = () => { menu.open = false; editDetails(p, goals); };
  app.querySelector("#mark-read")?.addEventListener("click", (e) => busy(e.currentTarget, "Marking…", async () => {
    await api(`/papers/${id}/finish`, { method: "POST" });
    paperPage(id, stale);
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
    paperPage(id, stale);
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
  app.querySelector("#refs-btn")?.addEventListener("click", (e) => busy(e.currentTarget, "Loading…", () => loadRefs(p)));
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
    location.hash = `#/papers/${id}/read`;
  } catch (e) { toast(e.message); }
}

function renderSkim(p) {
  const box = app.querySelector("#skim");
  const s = p.skim;
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  if (!s) {
    box.innerHTML = `<h2>Skim before you read</h2>
      <p class="skim-intro">A first pass in the style Andrew Ng recommends: what problem it tackles, what's new,
      how it works, what it shows, where it falls short, and which sections deserve a close read.</p>
      <button class="button" id="skim-btn">Skim this paper</button>`;
  } else {
    box.innerHTML = `<div class="section-bar"><h2>Key points</h2>
        <button class="button quiet" id="skim-btn">Redo</button></div>
      <p class="verdict">${esc(s.verdict)}</p>
      <div class="skim">
        <h3>Problem</h3><p>${esc(s.problem)}</p>
        <h3>Contributions</h3>${list(s.contributions)}
        <h3>Method</h3><p>${esc(s.method)}</p>
        <h3>Results</h3>${list(s.results)}
        <h3>Limitations</h3>${list(s.limitations)}
        <h3>Read closely</h3>${list(s.read_closely)}
      </div>`;
  }
  box.querySelector("#skim-btn").onclick = (e) => busy(e.currentTarget, "Reading the paper…", async () => {
    p.skim = await api(`/papers/${p.id}/skim`, { method: "POST" });
    renderSkim(p);
  });
}

async function loadRefs(p) {
  const box = app.querySelector("#refs");
  let refs;
  try { refs = await api(`/papers/${p.id}/references`); }
  catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  app.querySelector("#refs-btn")?.remove();
  box.innerHTML = refs.length ? `<div class="sheet list">${refs.map((r, i) => `<div class="ref">
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
const MODE_LABEL = { simplify: "Simplified", translate: "Translated" };

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
    <div class="reader-bar">
      <div class="reader-bar-inner">
        <a href="#/papers/${id}" class="reader-back" title="Back to paper overview"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(p.title)}</span></a>
        <div class="segmented small" role="group" aria-label="Mode" id="modes">
          <button data-track="read" class="active" title="Time spent reading counts towards your progress">Reading</button>
          <button data-track="skim" title="Jump around freely; nothing is recorded">Skimming</button></div>
        ${p.has_pdf && p.text ? `<div class="segmented small" role="group" aria-label="View" id="views">
          <button data-view="pdf">Original</button><button data-view="text">Text</button></div>` : ""}
        <select id="jump" class="jump" aria-label="Go to a section or page"><option value="">Go to…</option></select>
        <div class="zoom" id="zoom" role="group" aria-label="Zoom" hidden>
          <button class="button quiet small" data-zoom="-" title="Zoom out (−)">−</button>
          <button class="button quiet small zoom-value num" data-zoom="1" title="Fit to width">100%</button>
          <button class="button quiet small" data-zoom="+" title="Zoom in (+)">+</button></div>
        ${readingPrefsMenu()}
        <span class="reader-pct num" id="pct"></span>
        <button class="button secondary small" id="toggle-notes" title="Notes and questions (n)">Notes &amp; questions</button>
        <button class="button small" id="finish">${p.status === "read" ? "Done" : "Finish"}</button>
      </div>
      <div class="strip" id="strip" title="Read parts of the paper. Click to jump."><span class="strip-view" id="strip-view"></span></div>
      <div class="skim-note nudge" id="nudge" hidden>You've read most of this paper.
        <button class="button small" id="nudge-finish">Mark as finished</button>
        <button class="button quiet small" id="nudge-later">Not yet</button></div>
      <div class="skim-note" id="skim-note" hidden>Skimming: nothing you do here counts as reading.
        <button class="button quiet small" id="back-to-saved">Back to where you stopped</button></div>
    </div>
    <div class="reader">
      <article id="article">
        <div id="content"></div>
        <div class="article-end">
          <p>That's the end of the paper.</p>
          <button class="button" id="finish-end">I've finished, quiz me</button>
        </div>
      </article>
    </div>
    <aside class="notes" id="notes" aria-label="Notes and questions">
      <div class="notes-head"><h2>My notes</h2><button class="button quiet small" id="close-notes">Close</button></div>
      ${notesBox(p, 5)}
      <h2 class="ask-title">Ask about this paper</h2>
      <p class="hint">Select a passage in the paper and press <kbd>e</kbd>, or ask anything here. Claude answers with the whole paper in mind.</p>
      <form id="ask" class="ask">
        <input id="question" placeholder="How does this differ from earlier work?">
        <textarea id="passage" rows="3" placeholder="Passage to explain (optional)"></textarea>
        <button class="button small">Ask</button>
      </form>
      <div id="answers"></div>
      <h2 class="ask-title">Vocabulary</h2>
      <div id="reader-vocab" class="reader-vocab"></div>
    </aside>
    <div class="sel-bar" id="pop" role="toolbar" aria-label="Selected text" hidden>
      <button data-sel="explain" title="Explain it with the whole paper in mind (e)">Explain</button>
      <button data-sel="simplify" title="Rewrite it in simple English">Simplify</button>
      <button data-sel="translate" title="${language ? `Translate into ${esc(language)}` : "Set your language in Settings to translate"}">Translate</button>
      ${canSpeak() ? `<button data-sel="listen" title="Hear it read aloud (l)">Listen</button>` : ""}
      <button data-sel="word" title="Add this word to the paper's vocabulary">Save word</button>
    </div>`;

  const $ = (sel) => app.querySelector(sel);
  const article = $("#article");
  const content = $("#content");
  const pop = $("#pop");
  const setOpen = (open) => document.body.classList.toggle("notes-open", open);
  const barHeight = () => $(".reader-bar").offsetHeight;
  const positionNow = () => Math.min(1, Math.max(0, (scrollY - article.offsetTop) / Math.max(1, article.offsetHeight - innerHeight)));
  const scrollToPosition = (position) => window.scrollTo(0, article.offsetTop + position * (article.offsetHeight - innerHeight));
  const scrollToElement = (el, offset = 0) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY + offset - barHeight() - 12);
  let pdf = null;
  let targets = []; // "Go to…" destinations for the current view

  const show = async (next) => {
    view = next;
    pdf?.close();
    pdf = null;
    app.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    article.className = view === "pdf" ? "pdf-sheet" : "page-sheet";
    if (view === "text") {
      prepareTerms(p.glossary);
      const { html, headings } = renderPaperText(p, markTerms);
      content.innerHTML = html;
      targets = headings.map((h) => ({ label: `${h.level === 3 ? "  " : ""}${h.label}`, el: content.querySelector(`#${h.id}`), at: 0 }));
    } else {
      content.innerHTML = `<div class="pdf-pages" id="pages">${loading("Opening the PDF")}</div>`;
      try {
        pdf = await renderPdf(`/api/papers/${id}/file`, content.querySelector("#pages"), { zoom: savedZoom() });
        targets = [
          ...pdf.outline.map((o) => ({ label: `${o.depth ? "  " : ""}${o.title}`, el: o.el, at: o.at })),
          ...pdf.pages.map((el, i) => ({ label: `Page ${i + 1} of ${pdf.pages.length}`, el, at: 0, page: true })),
        ];
      } catch (e) {
        content.innerHTML = `<p class="error pad">Couldn't open the PDF: ${esc(e.message)}</p>`;
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
    if (pdf) $("#zoom .zoom-value").textContent = pct(pdf.zoom);
  };

  // Open the paper, then go back to where the reader stopped.
  await show(view);
  if (stale()) { pdf?.close(); return; }
  if (saved > 0.01 && saved < 0.99) {
    scrollToPosition(saved);
    toast(`Back where you stopped, ${pct(saved)} in`);
  }

  // ----- Tracking -----
  const words = p.text ? p.text.split(/\s+/).length : (pdf?.pages.length || 10) * 400;
  const tracker = startTracker({ article, paper: p, words, onRead: () => paintStrip() });
  // Papers tracked the old way keep their percentage until real reading overtakes it (same rule as the server).
  const legacy = p.read_slices ? 0 : p.progress;
  let nudged = p.status === "read"; // offer to finish once, when most of the paper has been read
  const paintStrip = () => {
    const read = Math.max(legacy, tracker.bits.filter((b) => b === "1").length / SLICES);
    $("#strip").style.background = stripBackground(tracker.bits);
    $("#pct").textContent = `${pct(read)} read`;
    if (!nudged && read >= 0.9) { nudged = true; $("#nudge").hidden = false; }
  };
  const paintView = () => {
    const height = article.offsetHeight;
    const marker = $("#strip-view");
    marker.style.left = pct(Math.max(0, (scrollY - article.offsetTop) / height));
    marker.style.width = pct(Math.min(1, innerHeight / height));
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

  const onScroll = () => { paintView(); pop.hidden = true; };
  addEventListener("scroll", onScroll, { passive: true });

  $("#strip").onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.scrollTo(0, article.offsetTop + ((e.clientX - r.left) / r.width) * article.offsetHeight - barHeight());
  };
  $("#jump").onchange = (e) => {
    const t = targets[e.target.value];
    if (t) scrollToElement(t.el, t.at * t.el.offsetHeight);
    e.target.value = "";
  };
  $("#modes").onclick = (e) => {
    const b = e.target.closest("[data-track]");
    if (!b || b.dataset.track === tracker.mode) return;
    flush();
    tracker.setMode(b.dataset.track);
    app.querySelectorAll("[data-track]").forEach((x) => x.classList.toggle("active", x === b));
    $("#skim-note").hidden = tracker.mode !== "skim";
    document.body.classList.toggle("skimming", tracker.mode === "skim");
    if (tracker.mode === "skim" && p.status === "new") {
      p.status = "skimmed";
      api(`/papers/${id}/progress`, { method: "PUT", json: { position: saved, mode: "skim" } }).catch(() => {});
    }
  };
  $("#back-to-saved").onclick = () => scrollToPosition(saved);
  $("#views")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-view]");
    if (!b || b.dataset.view === view) return;
    const position = positionNow();
    await show(b.dataset.view);
    scrollToPosition(position);
  });

  // ----- Explanations -----
  const answerHtml = (e) => `${MODE_LABEL[e.mode] ? `<p class="answer-mode">${MODE_LABEL[e.mode]}</p>` : ""}${quote(e.passage)}
    ${e.question ? `<p class="answer-q">${esc(e.question)}</p>` : ""}<div class="answer-body">${e.answer ? markdown(e.answer) : loading("Thinking")}</div>`;
  const explain = async (passage, question = "", mode = "explain") => {
    setOpen(true);
    const item = document.createElement("div");
    item.className = "answer";
    item.innerHTML = answerHtml({ passage, question, mode, answer: "" });
    $("#answers").prepend(item);
    try {
      const r = await api(`/papers/${id}/explain`, { method: "POST", json: { passage, question, mode } });
      item.innerHTML = answerHtml({ passage, question, mode, answer: r.explanation });
    } catch (e) {
      item.querySelector(".answer-body").innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };

  // Earlier explanations for this paper, newest first.
  api(`/papers/${id}/explanations`).then((items) => {
    $("#answers").innerHTML = items.map((e) => `<div class="answer">${answerHtml(e)}</div>`).join("");
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
    if (text.length < 2 || !sel.rangeCount || !article.contains(sel.anchorNode)) { pop.hidden = true; selection = null; return; }
    const range = sel.getRangeAt(0);
    selection = { text, range: range.cloneRange(), sentence: sentenceAround(range) };
    pop.querySelector("[data-sel=word]").hidden = text.split(/\s+/).length > 4;
    pop.hidden = false;
    const rect = range.getBoundingClientRect();
    const width = pop.offsetWidth;
    pop.style.top = `${Math.max(rect.top + scrollY - pop.offsetHeight - 10, scrollY + barHeight() + 6)}px`;
    pop.style.left = `${Math.min(innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))}px`;
  };
  article.addEventListener("mouseup", () => setTimeout(showSelectionBar));
  article.addEventListener("keyup", (e) => e.shiftKey && setTimeout(showSelectionBar));
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
    if (action === "word") {
      toast(`Adding "${text}" to the vocabulary…`);
      try {
        p.glossary = await api(`/papers/${id}/words`, { method: "POST", json: { term: text, context: sentence } });
        renderVocab($("#reader-vocab"), p, { compact: true });
        const w = p.glossary.find((x) => x.term.toLowerCase() === text.toLowerCase());
        setOpen(true);
        toast(w ? `${w.term}: ${w.meaning}` : "Added.");
      } catch (err) { toast(err.message); }
      return;
    }
    if (action === "translate" && !language) return toast("Set your language in Settings first, then Translate works.");
    highlight(range);
    explain(text, "", action);
  });

  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    const passage = $("#passage").value.trim();
    const question = $("#question").value.trim();
    if (!passage && !question) return $("#question").focus();
    explain(passage, question);
    $("#passage").value = $("#question").value = "";
  };
  $("#toggle-notes").onclick = () => setOpen(!document.body.classList.contains("notes-open"));
  $("#close-notes").onclick = () => setOpen(false);

  const finish = (e) => busy(e.currentTarget, "Wrapping up…", async () => {
    flush();
    const done = await api(`/papers/${id}/finish`, { method: "POST" });
    location.hash = done.quiz?.length ? `#/papers/${id}/quiz` : `#/papers/${id}`;
  });
  $("#nudge-finish").onclick = finish;
  $("#nudge-later").onclick = () => ($("#nudge").hidden = true);
  $("#finish").onclick = p.status === "read" ? () => (location.hash = `#/papers/${id}`) : finish;
  $("#finish-end").onclick = finish;

  bindNotes(p, $("#notes"));
  renderVocab($("#reader-vocab"), p, { compact: true });
  // Tap or click an underlined word to see what it means (hover works too on a computer).
  article.addEventListener("click", (e) => {
    const term = e.target.closest(".term");
    if (term && !getSelection().toString()) toast(`${term.textContent}: ${term.title}`);
  });
  // A newly generated vocabulary or a word marked as known changes the underlines in Text view.
  $("#reader-vocab").addEventListener("click", () => setTimeout(() => view === "text" && refreshTerms(), 0));
  $("#reader-vocab").addEventListener("known-changed", () => view === "text" && refreshTerms());
  const refreshTerms = () => {
    const position = positionNow();
    show("text").then(() => scrollToPosition(position));
  };

  // Keyboard: s = skim/read, n = notes panel, e = explain the selection, ? = help.
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "s") app.querySelector(`[data-track=${tracker.mode === "read" ? "skim" : "read"}]`).click();
    else if (e.key === "n") setOpen(!document.body.classList.contains("notes-open"));
    else if (e.key === "e" && !pop.hidden) pop.querySelector("[data-sel=explain]").click();
    else if (e.key === "l" && !pop.hidden) pop.querySelector("[data-sel=listen]")?.click();
    else if ((e.key === "+" || e.key === "=") && pdf) zoomBy(0.25);
    else if (e.key === "-" && pdf) zoomBy(-0.25);
    else if (e.key === "?") showShortcuts([["s", "Switch between reading and skimming"], ["n", "Open or close notes and questions"],
      ["e", "Explain the selected text"], ["l", "Listen to the selected text"], ["+ −", "Zoom the PDF (or Ctrl + mouse wheel)"]]);
    else return;
    e.preventDefault();
  };
  addEventListener("keydown", onKey);

  // ----- Zoom: redraws the PDF at the new size so it stays sharp -----
  const zoomTo = (z) => {
    if (!pdf) return;
    const position = positionNow();
    const zoom = pdf.setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* not remembered */ }
    $("#zoom .zoom-value").textContent = pct(zoom);
    scrollToPosition(position);
    paintView();
  };
  const zoomBy = (step) => pdf && zoomTo(pdf.zoom + step);
  $("#zoom").onclick = (e) => {
    const z = e.target.closest("[data-zoom]")?.dataset.zoom;
    if (z) zoomTo(z === "+" ? pdf.zoom + 0.25 : z === "-" ? pdf.zoom - 0.25 : 1);
  };
  // Ctrl + wheel over the PDF zooms the pages (sharp), not the whole browser (blurry).
  const onWheel = (e) => {
    if (!pdf || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
  };
  article.addEventListener("wheel", onWheel, { passive: false });
  bindReadingPrefs(app.querySelector(".reader-bar"));

  return () => {
    stopSpeaking();
    removeEventListener("keydown", onKey);
    flush(true);
    tracker.stop();
    clearInterval(flushTimer);
    removeEventListener("scroll", onScroll);
    removeEventListener("pagehide", onHide);
    pdf?.close();
    document.body.classList.remove("notes-open", "skimming");
  };
}

// ---------- Review (flashcards) ----------
const RATINGS = [[1, "Got it"], [0.5, "Partly"], [0, "Missed it"]];

export async function quizPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const p = await api(`/papers/${id}`);
  if (stale()) return;
  const crumbs = `<nav class="crumbs"><a href="#/papers/${id}">${esc(p.title)}</a></nav>`;

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
