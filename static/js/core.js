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

export function progressBar(p) {
  return `<span class="bar" role="img" aria-label="${pct(p.progress)} read"><span style="width:${pct(p.progress)}"></span></span>`;
}

export function paperRow(p, goals = {}) {
  const goal = p.topic_id && goals[p.topic_id];
  return `<a class="row" href="#/papers/${p.id}">
    <span class="row-main">
      <span class="row-title">${esc(p.title)}</span>
      <span class="row-meta">${cite(p)}${goal ? `<span class="row-goal">Goal: ${esc(goal)}</span>` : ""}</span>
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

// "Upload a paper" control; pair with bindUploads() after rendering.
export const uploadControl = (topicId = "") => `<label class="button secondary upload">
  <span>Upload a paper</span><input type="file" accept="application/pdf,.pdf" data-upload="${topicId}" hidden></label>`;

export function bindUploads() {
  app.querySelectorAll("[data-upload]").forEach((input) => {
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const label = input.closest("label").querySelector("span");
      const form = new FormData();
      form.append("file", file);
      if (input.dataset.upload) form.append("topic_id", input.dataset.upload);
      label.textContent = "Uploading…";
      try {
        const paper = await api("/papers/upload", { method: "POST", body: form });
        location.hash = `#/papers/${paper.id}`;
      } catch (e) {
        toast(e.message);
        label.textContent = "Upload a paper";
        input.value = "";
      }
    };
  });
}
