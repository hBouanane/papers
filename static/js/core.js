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
  const original = button?.textContent;
  if (button) { button.disabled = true; if (label) button.textContent = label; }
  try { return await fn(); }
  catch (e) { toast(e.message); }
  finally { if (button && button.isConnected) { button.disabled = false; button.textContent = original; } }
}

export const STATUS = { new: "To read", skimmed: "Skimmed", reading: "Reading", read: "Read" };

export const statusTag = (p) => `<span class="status status-${p.status}">${STATUS[p.status]}</span>`;

export const meta = (p) => [p.authors, p.year].filter(Boolean).map(esc).join(" · ");

export function progressLine(p) {
  return `<span class="progress" title="Read ${pct(p.progress)} · stopped at ${pct(p.position)}">
    <span class="progress-fill" style="width:${pct(p.progress)}"></span>
    ${p.status !== "reading" ? "" : `<span class="progress-mark" style="left:${pct(p.position)}"></span>`}</span>`;
}

export function paperRow(p, goals = {}) {
  const goal = p.topic_id && goals[p.topic_id];
  const understood = p.understanding == null ? "—" : pct(p.understanding);
  return `<a class="paper-row" href="#/papers/${p.id}">
    <span class="paper-row-main">
      <span class="paper-row-title">${esc(p.title)}</span>
      <span class="paper-row-meta">${meta(p)}${goal ? ` <span class="sep">in</span> ${esc(goal)}` : ""}</span>
    </span>
    <span class="paper-row-stat">${statusTag(p)}</span>
    <span class="paper-row-stat">${progressLine(p)}<span class="num">${pct(p.progress)}</span></span>
    <span class="paper-row-stat num" title="Understanding from your last quiz">${understood}</span>
  </a>`;
}

export const paperTableHead = `<div class="paper-head">
  <span>Paper</span><span>Status</span><span>Read</span><span>Understood</span></div>`;

export const empty = (text, action = "") => `<div class="empty"><p>${text}</p>${action}</div>`;

export const loading = (text = "Loading") => `<p class="loading">${text}…</p>`;
