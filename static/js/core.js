import { stripBackground } from "./tracker.js";

export const app = document.getElementById("app");

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
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
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
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
  return `<a class="row" href="#/papers/${p.id}">
    <span class="row-main">
      <span class="row-title">${esc(p.title)}</span>
      <span class="row-meta">${cite(p)}${goal ? `<span class="row-goal">Goal: ${esc(goal)}</span>` : ""}</span>
      ${snippet ? `<span class="row-snippet">${snippetHtml(snippet)}</span>` : ""}
    </span>
    <span class="row-cell">${statusTag(p)}</span>
    <span class="row-cell">${progressBar(p)}<span class="num">${pct(p.progress)}</span></span>
    <span class="row-cell num row-score">${p.understanding == null ? `<span class="faint">Not tested</span>` : pct(p.understanding)}</span>
  </a>`;
}

export const tableHead = `<div class="row row-head" aria-hidden="true">
  <span>Paper</span><span>Status</span><span>Read</span><span class="row-score">Understood</span></div>`;

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
