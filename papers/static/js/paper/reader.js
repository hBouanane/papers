// The reader: the PDF (or the paper's text), with selection tools (explain, translate, highlight, note),
// reading progress, read-aloud and the bar on top.
import { api, apiStream, app, busy, cameFrom, esc, knownWords, loading, markdown, pct, quote, renderVocab, showShortcuts, toast } from "../core.js";
import { drawPdf, drawPdfPage, drawText, pdfAnchor, textAnchor } from "../highlights.js";
import { bindNotesList, COLORS, noteStore } from "../notes.js";
import { openPdf } from "../pdfview.js";
import { bindReadingPrefs, pageToneControl, pdfPagesDark, readingPrefsMenu, setPageTone, toggleDarkPages } from "../readprefs.js";
import { canSpeak, speak, speaking, stopSpeaking } from "../speech.js";
import { renderPaperText } from "../textview.js";
import { SLICES, startTracker, stripBackground } from "../tracker.js";
import { celebrate } from "./shared.js";

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
        <a href="#/papers/${id}" class="reader-back" title="Back to ${esc(p.title)}" aria-label="Back to the paper's page"><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="reader-back-label">Paper</span></a>
        ${p.has_pdf && p.text ? `<div class="segmented small" role="group" aria-label="View" id="views">
          <button data-view="pdf">Original</button><button data-view="text">Text</button></div>` : ""}
        <select id="jump" class="jump" aria-label="Go to a section or page"><option value="">Go to…</option></select>
        <div class="zoom" id="zoom" role="group" aria-label="Zoom" hidden>
          <button class="button quiet small" data-zoom="out" title="Zoom out (−)">−</button>
          <button class="button quiet small zoom-value num" data-zoom="fit" title="Fit to width">100%</button>
          <button class="button quiet small" data-zoom="in" title="Zoom in (+)">+</button></div>
        <div class="hl-tool" id="hl-tool" role="group" aria-label="Highlighter">
          <button class="hl-tool-btn" id="hl-toggle" aria-pressed="false" title="Highlighter: select text to highlight it at once (h, Esc to stop)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg><span class="hl-dot" id="hl-tool-dot"></span></button>
          <span class="hl-tool-colors">${COLORS.map((c) => `<button class="hl-dot hl-${c}" data-tool-color="${c}" aria-label="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join("")}</span>
        </div>
        ${readingPrefsMenu()}
        <button class="switch" id="skim" role="switch" aria-checked="false" title="Skim freely: nothing you do counts as reading (s)"><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Skimming</span></button>
        ${pageToneControl()}
        <details class="menu bar-more" id="bar-more" hidden><summary class="button secondary small" title="More tools" aria-label="More tools">⋯</summary>
          <div class="menu-list sheet bar-more-list" id="bar-more-list"></div></details>
        <span class="reader-pct num" id="pct" title="How much you've actually read. Fast scrolling and jumps don't count."></span>
        <button class="button secondary small" id="toggle-notes" title="Ask the AI, words, your notes (n)">Ask &amp; notes</button>
      </div>
      <div class="strip" id="strip" title="Parts you've read. Click to jump."><span class="strip-view" id="strip-view"></span></div>
    </div>
    <div class="reader-scroll" id="scroller"></div>
    <nav class="reader-route" id="route" aria-label="Where you are"></nav>
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
            <p>Or ask anything below. The AI answers with the whole paper in mind.</p>
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
    <div class="sel-bar hl-pop" id="hl-pop" role="toolbar" aria-label="Highlight" hidden>
      <span class="sel-colors">${COLORS.map((c) => `<button data-hl-color="${c}" class="sel-dot" aria-label="${c}" title="${c[0].toUpperCase() + c.slice(1)}"><span class="hl-dot hl-${c}"></span></button>`).join("")}</span>
      <button data-hl-act="note">Note</button>
      <button data-hl-act="remove">Remove</button>
    </div>
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

  // Where you are: the page you opened the paper from, the paper, and Reading. Shown above the paper.
  const origin = cameFrom(`/papers/${id}`) || "/";
  const ORIGIN = { "/": "Library", "/goals": "Goals", "/recall": "Recall", "/map": "Map", "/settings": "Settings" };
  let originLabel = ORIGIN[origin] || (/^\/goals\/\d+$/.test(origin) ? "Goal" : /^\/papers\/\d+$/.test(origin) ? "Previous paper" : "Library");
  const routeLine = () => `<a href="#${ORIGIN[origin] || /^\/(goals|papers)\/\d+$/.test(origin) ? origin : "/"}" data-origin>${esc(originLabel)}</a>
      <span aria-hidden="true">›</span><a href="#/papers/${id}" class="route-paper" title="${esc(p.title)}">${esc(p.title)}</a><span aria-hidden="true">›</span><span>Reading</span>`;
  $("#route").innerHTML = routeLine();
  if (/^\/goals\/\d+$/.test(origin)) api("/topics").then((goals) => {
    const g = goals.find((x) => `/goals/${x.id}` === origin);
    if (g) { originLabel = g.goal; app.querySelectorAll("[data-origin]").forEach((a) => (a.textContent = g.goal)); }
  }).catch(() => {});

  // The bar stays one row: when it doesn't fit, the less-used tools move into the ⋯ menu, least used first,
  // and come back when there's room again.
  const OVERFLOW = ["#page-tone", "#skim", "#zoom", ".prefs-menu", "#jump"];
  const homes = new Map();
  const fitBar = () => {
    const inner = app.querySelector(".reader-bar-inner");
    const more = $("#bar-more"), list = $("#bar-more-list");
    if (!inner || !more) return;
    OVERFLOW.forEach((sel) => {
      const el = app.querySelector(sel);
      if (!el) return;
      if (!homes.has(sel)) { const mark = document.createComment(sel); el.before(mark); homes.set(sel, mark); }
      homes.get(sel).after(el);
    });
    more.hidden = true;
    for (const sel of OVERFLOW) {
      if (inner.scrollWidth <= inner.clientWidth) break;
      const el = app.querySelector(sel);
      if (!el || el.hidden) continue;
      more.hidden = false;
      list.append(el);
    }
    if (!more.querySelector(".bar-more-list > *:not([hidden])")) more.hidden = true;
  };
  new ResizeObserver(() => fitBar()).observe(app.querySelector(".reader-bar-inner"));

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
    app.querySelector(".prefs-menu").hidden = view !== "text"; // text size, spacing and font only apply to the Text view
    if (pdf) $("#zoom .zoom-value").textContent = pct(pdf.zoom);
    if (pdf) pdf.onPageRendered((n, div) => drawPdfPage(div, n, notes.items));
    drawMarks();
    setTimeout(() => (settling = false), 800); // callers put you back where you were in the meantime
    fitBar();
  };

  // Open the paper, then go back to where the reader stopped.
  await show(view);
  if (stale()) { pdf?.close(); barObserver.disconnect(); return; }
  let jumpTo = null;
  let toPage = null;
  try {
    jumpTo = Number(sessionStorage.getItem(`papers.jump.${id}`)) || null; sessionStorage.removeItem(`papers.jump.${id}`);
    toPage = Number(sessionStorage.getItem(`papers.page.${id}`)) || null; sessionStorage.removeItem(`papers.page.${id}`);
  } catch { /* none */ }
  if (toPage && pdf) { pdf.goToPage(toPage); jumpTo = jumpTo || -1; }
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
  scroller.addEventListener("mouseup", () => setTimeout(() => (tool.on ? highlightSelection() : showSelectionBar())));
  scroller.addEventListener("keyup", (e) => e.shiftKey && setTimeout(showSelectionBar));
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection while clicking

  // ----- The highlighter tool (like a real marker): select text and it's highlighted, no menu. -----
  const TOOL_KEY = "papers.highlighter";
  const tool = (() => { try { return { on: false, color: "yellow", ...JSON.parse(localStorage.getItem(TOOL_KEY) || "{}") }; } catch { return { on: false, color: "yellow" }; } })();
  const cursorFor = (color) => {
    const fill = getComputedStyle(document.documentElement).getPropertyValue(`--dot-${color}`).trim() || "#f0c000";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M4 22l2.5-6.5L17 5l4 4-10.5 10.5z' fill='${fill}' stroke='#1b1e23' stroke-width='1.4' stroke-linejoin='round'/><path d='M4 22l2.5-6.5 4 4z' fill='#1b1e23'/><path d='M15 7l4 4' stroke='#1b1e23' stroke-width='1.4'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 22`;
  };
  const paintTool = () => {
    $("#hl-toggle").setAttribute("aria-pressed", tool.on);
    $("#hl-tool").classList.toggle("on", tool.on);
    $("#hl-tool-dot").className = `hl-dot hl-${tool.color}`;
    app.querySelectorAll("[data-tool-color]").forEach((b) => b.classList.toggle("active", b.dataset.toolColor === tool.color));
    scroller.classList.toggle("highlighting", tool.on);
    scroller.style.setProperty("--hl-cursor", cursorFor(tool.color));
    try { localStorage.setItem(TOOL_KEY, JSON.stringify(tool)); } catch { /* not remembered */ }
  };
  const setTool = (on) => {
    tool.on = on;
    paintTool();
    if (on) { pop.hidden = true; toast(`Highlighter on: select text to highlight it ${tool.color}. Esc to stop.`); }
  };
  $("#hl-toggle").onclick = () => setTool(!tool.on);
  $("#hl-tool").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool-color]");
    if (!b) return;
    tool.color = b.dataset.toolColor;
    if (!tool.on) setTool(true); else paintTool();
  });
  const highlightSelection = async () => {
    const sel = getSelection();
    const text = sel.toString().trim();
    if (text.length < 2 || !sel.rangeCount || !scroller.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0).cloneRange();
    sel.removeAllRanges();
    await addHighlight(range, text, tool.color);
  };
  paintTool();

  // ----- Click a highlight on the page: change its colour, add a note, or remove it. -----
  const hlPop = $("#hl-pop");
  let picked = null; // the note whose highlight was clicked
  const highlightAt = (e) => {
    const mark = e.target.closest?.("mark.hl[data-note]");
    if (mark) return { id: Number(mark.dataset.note), box: mark.getBoundingClientRect() };
    // In the PDF the marks sit under the text, so find the one under the pointer by its position.
    for (const el of scroller.querySelectorAll(".hl-layer .hl")) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2) return { id: Number(el.dataset.note), box: r };
    }
    return null;
  };
  const openHighlight = (hit) => {
    picked = notes.items.find((n) => n.id === hit.id);
    if (!picked) return;
    hlPop.querySelectorAll("[data-hl-color]").forEach((b) => b.classList.toggle("active", b.dataset.hlColor === picked.color));
    hlPop.querySelector("[data-hl-act=note]").textContent = picked.body ? "Edit note" : "Note";
    hlPop.hidden = false;
    const top = scroller.getBoundingClientRect().top;
    hlPop.style.top = `${Math.max(hit.box.top - hlPop.offsetHeight - 10, top + 6)}px`;
    hlPop.style.left = `${Math.min(innerWidth - hlPop.offsetWidth - 8, Math.max(8, hit.box.left + hit.box.width / 2 - hlPop.offsetWidth / 2))}px`;
  };
  const closeHighlight = () => { hlPop.hidden = true; picked = null; };
  hlPop.addEventListener("click", async (e) => {
    if (!picked) return;
    const note = picked;
    const color = e.target.closest("[data-hl-color]")?.dataset.hlColor;
    const act = e.target.closest("[data-hl-act]")?.dataset.hlAct;
    closeHighlight();
    if (color && color !== note.color) await notes.edit(note.id, { color }).catch((err) => toast(err.message));
    if (act === "note") { setOpen(true, "notes"); notesUi.edit(note.id); }
    if (act === "remove") {
      await notes.remove(note.id).catch((err) => toast(err.message));
      toast("Highlight removed.", { label: "Undo", run: () => {
        const { kind, body, quote, color: c, page, position, anchor } = note;
        notes.add({ kind, body, quote, color: c, page, position, anchor }).catch((err) => toast(err.message));
      } });
    }
  });
  const onOutside = (e) => { if (!hlPop.hidden && !hlPop.contains(e.target)) closeHighlight(); };
  document.addEventListener("mousedown", onOutside);
  scroller.addEventListener("scroll", () => { if (!hlPop.hidden) closeHighlight(); }, { passive: true });
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
    if (!getSelection().toString().trim()) {
      const hit = highlightAt(e);
      if (hit) return openHighlight(hit);
    }
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
    else if (e.key === "h") { if (!pop.hidden) pop.querySelector("[data-sel=highlight]").click(); else setTool(!tool.on); }
    else if (e.key === "Escape" && (tool.on || !hlPop.hidden)) { closeHighlight(); if (tool.on) setTool(false); }
    else if ((e.key === "+" || e.key === "=") && pdf) pdf.zoomBy(1.25, middle());
    else if (e.key === "-" && pdf) pdf.zoomBy(0.8, middle());
    else if (e.key === "d" && pdf) toast(toggleDarkPages() ? "Dark pages on (press d to turn off)." : "Dark pages off.");
    else if (e.key === "?") showShortcuts([["s", "Skimming on or off (nothing counts while it's on)"], ["d", "Dark PDF pages on or off"], ["n", "Open or close Ask, Words and Notes"],
      ["e", "Explain the selected text"], ["h", "Highlight the selected text, or turn the highlighter on and off"], ["l", "Listen to the selected text"], ["+ −", "Zoom the PDF (or Ctrl + mouse wheel, or pinch)"]]);
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
    document.removeEventListener("mousedown", onOutside);
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
