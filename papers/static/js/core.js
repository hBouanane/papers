import { cover } from "./covers.js";
import { speak } from "./speech.js";
import { stripBackground } from "./tracker.js";

export const app = document.getElementById("app");

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const pct = (x) => `${Math.round((x || 0) * 100)}%`;

// `action` ({ label, run }) adds one button, e.g. Undo.
export function toast(msg, action = null) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  if (action) {
    const b = Object.assign(document.createElement("button"), { className: "toast-action", textContent: action.label });
    b.onclick = () => { t.hidden = true; action.run(); };
    t.append(" ", b);
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4500);
}

export async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(`/api${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// Runs an action with the button disabled and a busy label; errors become a toast.
export async function busy(button, label, fn) {
  const original = button?.innerHTML;
  if (button) { button.disabled = true; if (label) button.textContent = label; }
  try { return await fn(); }
  catch (e) { toast(e.message); }
  finally { if (button && button.isConnected) { button.disabled = false; button.innerHTML = original; } }
}

export const STATUS = { new: "To read", skimmed: "Skimmed", reading: "Reading", read: "Read" };

export const statusTag = (p) => `<span class="chip chip-${p.status}">${STATUS[p.status]}</span>`;

// Citation style: "Vaswani et al. (2017)".
export function cite(p) {
  const names = (p.authors || "").split(",").map((s) => s.trim()).filter(Boolean);
  const surname = (n) => (n.endsWith("et al.") ? n : n.split(" ").pop());
  const who = names.length > 2 ? `${surname(names[0])} et al.`
    : names.map(surname).join(" and ");
  return esc([who, p.year && `(${p.year})`].filter(Boolean).join(" "));
}

// Shows which parts were read when the paper has slice tracking, else a plain bar.
export function progressBar(p) {
  const label = `role="img" aria-label="${pct(p.progress)} read"`;
  if (p.read_slices) return `<span class="bar" ${label} style="background:${stripBackground(p.read_slices.split(""))}"></span>`;
  return `<span class="bar" ${label}><span style="width:${pct(p.progress)}"></span></span>`;
}

// Search snippets come back with matches wrapped in [brackets].
const snippetHtml = (s) => esc(s).replace(/\[([^\]]*)\]/g, "<b>$1</b>");

export function paperRow(p, goals = {}, snippet = "") {
  const goal = p.topic_id && goals[p.topic_id];
  const actions = p.archived
    ? `<button class="button quiet small" data-act="restore">Restore</button>
       <button class="button quiet small danger" data-act="delete">Delete</button>`
    : `<button class="button quiet small" data-act="archive" title="Hide it from your lists. You can restore it from Archived.">Archive</button>`;
  // A light row: a tiny first page, the title (two lines at most) with authors and goal, one progress cell
  // (status and how much is read), the quiz score only once tested, and actions when you point at it.
  return `<div class="row paper" data-id="${p.id}" data-title="${esc(p.title)}">
    <span class="row-thumb" aria-hidden="true">${cover(p, "small")}</span>
    <span class="row-main">
      <a class="row-title" href="#/papers/${p.id}">${esc(p.title)}</a>
      <span class="row-meta">${cite(p) ? `<span>${cite(p)}</span>` : ""}${goal ? `<span class="row-goal">${esc(goal)}</span>` : ""}</span>
      ${snippet ? `<span class="row-snippet">${snippetHtml(snippet)}</span>` : ""}
    </span>
    <span class="row-progress"><span class="row-status status-${p.status}">${STATUS[p.status] || p.status}</span>
      <span class="row-bar">${progressBar(p)}<span class="num">${pct(p.progress)}</span></span></span>
    <span class="row-cell num row-score">${p.understanding == null ? `<span class="faint" title="Not tested yet">—</span>` : pct(p.understanding)}</span>
    <span class="row-actions">${actions}</span>
  </div>`;
}

// Clicking a row opens the paper; its buttons archive, restore or delete it, then call onChange.
export function bindRows(container, onChange) {
  container.addEventListener("click", async (e) => {
    const row = e.target.closest(".row.paper");
    if (!row) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) {
      if (!e.target.closest("a")) location.hash = `#/papers/${row.dataset.id}`;
      return;
    }
    const id = row.dataset.id;
    try {
      if (act === "delete") {
        if (!confirm(`Delete "${row.dataset.title}"? Its PDF, notes and explanations are removed too. This can't be undone.`)) return;
        await fetch(`/api/papers/${id}`, { method: "DELETE" });
        toast("Paper deleted.");
      } else {
        await api(`/papers/${id}`, { method: "PATCH", json: { archived: act === "archive" } });
        toast(act === "archive" ? "Archived. Find it under Archived." : "Restored to your library.");
      }
      row.remove();
      onChange?.();
    } catch (err) { toast(err.message); }
  });
}

export const tableHead = `<div class="row row-head" aria-hidden="true">
  <span></span><span>Paper</span><span>Progress</span><span class="row-score">Understood</span><span></span></div>`;

export const empty = (text, action = "") => `<div class="empty"><p>${text}</p>${action}</div>`;

export const loading = (text = "Loading") => `<p class="loading">${text}…</p>`;

// ---------- Adding papers ----------
// Used by the Add panel, by pasting a link anywhere, and by dropping PDFs on the window.

export const looksLikePaperLink = (text) =>
  /arxiv\.org\/|^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$|\b10\.\d{4,9}\/|semanticscholar\.org\/paper|^https?:\/\/\S+\.pdf(\?\S*)?$/i.test(text.trim());

export const addFromLink = (link, topicId) =>
  api("/papers/from-link", { method: "POST", json: { link: link.trim(), topic_id: topicId ? Number(topicId) : null } });

// Uploads PDFs one by one; returns the papers added (or matched) and the errors.
export async function uploadPdfs(files, topicId, onProgress = () => {}) {
  const added = [];
  const errors = [];
  for (const [i, file] of [...files].entries()) {
    onProgress(`Uploading ${file.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ""}…`);
    const form = new FormData();
    form.append("file", file);
    if (topicId) form.append("topic_id", topicId);
    try { added.push(await api("/papers/upload", { method: "POST", body: form })); }
    catch (e) { errors.push(`${file.name}: ${e.message}`); }
  }
  return { added, errors };
}

// The goal of the page you're on, so captured papers land there.
export const currentGoal = () => location.hash.match(/^#\/goals\/(\d+)/)?.[1] || "";

// "Add paper" control: paste a link or upload PDFs. Pair with bindAddPaper() after rendering.
export const addPaperControl = (topicId = "", goals = []) => `<details class="add-paper" data-topic="${topicId}">
  <summary class="button">Add paper</summary>
  <div class="add-panel sheet">
    <form class="add-link">
      <label>Paste a link
        <input name="link" required placeholder="arxiv.org/abs/1706.03762, a DOI, or a PDF link"></label>
      <button class="button">Add</button>
    </form>
    <p class="add-or">or</p>
    <label class="button secondary add-file"><span>Upload PDFs</span><input type="file" accept="application/pdf,.pdf" multiple hidden></label>
    ${!topicId && goals.length ? `<label class="add-goal">Goal
      <select name="goal"><option value="">No goal</option>${goals.map((g) => `<option value="${g.id}">${esc(g.goal)}</option>`).join("")}</select></label>` : ""}
    <p class="add-hint">Tip: paste a link or drop PDFs anywhere in the app.</p>
    <p class="add-status" role="status"></p>
  </div>
</details>`;

export function bindAddPaper() {
  app.querySelectorAll(".add-paper").forEach((box) => {
    const topic = () => box.dataset.topic || box.querySelector("select[name=goal]")?.value || "";
    const status = box.querySelector(".add-status");
    const fail = (msg) => { status.textContent = msg; status.classList.add("error"); };
    box.addEventListener("toggle", () => box.open && box.querySelector("input[name=link]").focus());
    box.querySelector(".add-link").onsubmit = (e) => {
      e.preventDefault();
      status.classList.remove("error");
      const link = e.target.link.value;
      busy(e.submitter, "Adding…", async () => {
        status.textContent = "Finding the paper and downloading its PDF…";
        try { location.hash = `#/papers/${(await addFromLink(link, topic())).id}`; }
        catch (err) { fail(err.message); }
      });
    };
    box.querySelector(".add-file input").onchange = async (e) => {
      if (!e.target.files.length) return;
      status.classList.remove("error");
      const { added, errors } = await uploadPdfs(e.target.files, topic(), (msg) => (status.textContent = msg));
      e.target.value = "";
      if (errors.length) return fail(errors.join(" "));
      if (added.length === 1) location.hash = `#/papers/${added[0].id}`;
      else { toast(`Added ${added.length} papers.`); window.dispatchEvent(new HashChangeEvent("hashchange")); }
    };
  });
}

export const quote = (passage) => passage
  ? `<p class="answer-quote">${esc(passage.length > 400 ? passage.slice(0, 400) + "…" : passage)}</p>` : "";

// Keyboard help, shown with "?".
export function showShortcuts(extra = []) {
  const keys = [["/", "Search your library"], ["?", "Show these shortcuts"], ...extra];
  let box = document.getElementById("shortcuts");
  if (!box) {
    box = document.createElement("div");
    box.id = "shortcuts";
    box.className = "sheet shortcuts";
    document.body.append(box);
    box.onclick = () => box.remove();
  }
  box.innerHTML = `<h2>Keyboard shortcuts</h2><dl>${keys.map(([k, what]) => `<div><dt><kbd>${k}</kbd></dt><dd>${what}</dd></div>`).join("")}</dl>
    <p class="faint">Click anywhere on this box or press Escape to close.</p>`;
}

// ---------- Vocabulary ----------
// Words you mark as known are hidden in every paper (kept in this browser).
const KNOWN_KEY = "papers.knownWords";
export function knownWords() {
  try { return new Set(JSON.parse(localStorage.getItem(KNOWN_KEY) || "[]")); } catch { return new Set(); }
}
function saveKnown(set) {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify([...set])); } catch { /* private mode: not remembered */ }
}
export function setKnown(term, known = true) {
  const set = knownWords();
  known ? set.add(term.toLowerCase()) : set.delete(term.toLowerCase());
  saveKnown(set);
}

// Renders the vocabulary list into `box` and wires its controls. Re-renders itself on changes.
export function renderVocab(box, paper, { compact = false } = {}) {
  let filter = box.dataset.filter || "all";
  let showKnown = box.dataset.showKnown === "1";
  const draw = () => {
    box.dataset.filter = filter;
    box.dataset.showKnown = showKnown ? "1" : "";
    const words = paper.glossary;
    if (!words?.length) {
      box.innerHTML = `${compact ? "" : "<h2>Vocabulary</h2>"}
        <p class="hint">The words in this paper most likely to slow you down, technical terms and plain English alike,
        explained in simple words with the sentence where they appear.</p>
        ${paper.text ? `<button class="button ${compact ? "small" : ""}" data-vocab="make">Find hard words</button>`
          : `<p class="faint">Needs the paper's text: upload its PDF first.</p>`}`;
      return;
    }
    const known = knownWords();
    const counts = { all: words.length, technical: 0, english: 0 };
    words.forEach((w) => counts[w.kind]++);
    const visible = words.filter((w) => (filter === "all" || w.kind === filter) && (showKnown || !known.has(w.term.toLowerCase())));
    const hidden = words.filter((w) => (filter === "all" || w.kind === filter) && known.has(w.term.toLowerCase())).length;
    box.innerHTML = `<div class="section-bar">${compact ? "" : "<h2>Vocabulary</h2>"}
        <div class="segmented small" role="group" aria-label="Kind of word">
          ${[["all", "All"], ["technical", "Technical"], ["english", "English"]].map(([k, label]) =>
            `<button data-vocab-filter="${k}" class="${filter === k ? "active" : ""}">${label} <span class="num">${counts[k]}</span></button>`).join("")}
        </div></div>
      <dl class="vocab">${visible.map((w) => `<div class="word${known.has(w.term.toLowerCase()) ? " known" : ""}">
          <dt><span class="term-name">${esc(w.term)}</span><span class="chip">${w.kind === "english" ? "English" : "Technical"}</span>
            ${w.source === "ai" ? `<span class="ai-mark" title="Added by the AI (Deep mode)">AI</span>` : ""}
            <span class="word-actions"><button class="link-button" data-vocab-listen="${esc(w.term)}" title="Hear how it's pronounced">Listen</button>
            <button class="link-button" data-vocab-known="${esc(w.term)}">${known.has(w.term.toLowerCase()) ? "Show again" : "I know this"}</button></span></dt>
          <dd>${w.translation ? `<span class="translation">${esc(w.translation)}</span>` : ""}${esc(w.meaning)}${w.example ? `<q>${esc(w.example)}</q>` : ""}</dd></div>`).join("")
        || `<p class="faint">${hidden ? "You know all of these." : "None of this kind."}</p>`}</dl>
      <div class="vocab-foot">
        ${hidden ? `<button class="link-button" data-vocab="toggle-known">${showKnown ? "Hide words I know" : `Show ${hidden} word${hidden === 1 ? "" : "s"} I know`}</button>` : ""}
        ${compact ? "" : `<button class="link-button" data-vocab="make">Find again</button>`}
      </div>`;
  };
  box.onclick = (e) => {
    const t = e.target.closest("[data-vocab], [data-vocab-filter], [data-vocab-known], [data-vocab-listen]");
    if (!t) return;
    if (t.dataset.vocabListen) return speak(t.dataset.vocabListen);
    if (t.dataset.vocabFilter) { filter = t.dataset.vocabFilter; return draw(); }
    if (t.dataset.vocabKnown) {
      const known = knownWords();
      const key = t.dataset.vocabKnown.toLowerCase();
      known.has(key) ? known.delete(key) : known.add(key);
      saveKnown(known);
      box.dispatchEvent(new CustomEvent("known-changed", { bubbles: true }));
      return draw();
    }
    if (t.dataset.vocab === "toggle-known") { showKnown = !showKnown; return draw(); }
    if (t.dataset.vocab === "make") {
      busy(t, "Reading the paper for hard words…", async () => {
        paper.glossary = await api(`/papers/${paper.id}/glossary`, { method: "POST" });
        draw();
      });
    }
  };
  draw();
}

// Claude answers in light Markdown; show it formatted (escaped first, so nothing in it can inject HTML).
export function markdown(text) {
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else {
      closeList();
      if (heading) out.push(`<p class="md-head">${inline(heading[1])}</p>`);
      else if (line) out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

// ---------- App bar ----------
// Main pages show the app's name; pages inside them show a back arrow and their own title,
// the same way the reader does.
const BACK_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Where each page was opened from, kept on its browser history entry (so it stays right with the
// browser's back and forward buttons). A back arrow uses it: a paper opened from the Library goes back
// to the Library, one opened from a goal goes back to that goal.
let lastTrail = [];
let lastPath = null;
export function noteVisit(path) {
  let state = history.state;
  if (!state?.trail) { // a new page, not a step back or forward
    state = { ...(state || {}), trail: lastPath && lastPath !== path ? [...lastTrail, lastPath].slice(-20) : lastTrail };
    history.replaceState(state, "");
  }
  lastTrail = state.trail;
  lastPath = path;
}
// The page this one was opened from, skipping its own sub-pages (a paper's reader and quiz).
export function cameFrom(here) {
  const trail = history.state?.trail || [];
  for (let i = trail.length - 1; i >= 0; i--) if (!trail[i].startsWith(here)) return trail[i];
  return null;
}

export function setBar({ back, title } = {}) {
  const start = document.getElementById("bar-start");
  start.innerHTML = back
    ? `<a href="${back.href}" class="reader-back" title="Back to ${esc(back.label)}">${BACK_ICON}<span>${esc(back.label)}</span></a>`
    : `<a href="#/" class="wordmark">Papers</a>`;
}
