// Your notes and highlights on a paper: one list, in the paper's order.
// A highlight shows the quoted text (its colour as a bar) and can carry a note; a plain note is just text.
// Click the quote or the place to jump there; Edit and Delete work in place, and a delete can be undone.
import { api, esc, moreButton, PAGE, toast } from "./core.js";

export const COLORS = ["yellow", "green", "blue", "pink"];

// The list for one paper, shared by the side panel and the marks drawn on the paper.
export function noteStore(paperId) {
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(store.items));
  const order = () => store.items.sort((a, b) => a.position - b.position || a.id - b.id);
  const store = {
    items: [],
    async load() { store.items = await api(`/papers/${paperId}/notes`); order(); emit(); },
    async add(fields) {
      const note = await api(`/papers/${paperId}/notes`, { method: "POST", json: fields });
      store.items.push(note); order(); emit();
      return note;
    },
    async edit(id, fields) {
      const note = await api(`/notes/${id}`, { method: "PATCH", json: fields });
      store.items = store.items.map((n) => (n.id === id ? note : n)); emit();
      return note;
    },
    async remove(id) {
      await api(`/notes/${id}`, { method: "DELETE" });
      store.items = store.items.filter((n) => n.id !== id); emit();
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return store;
}

const place = (n) => (n.page ? `p. ${n.page}` : `${Math.round(n.position * 100)}% in`);

// `here()` gives { position, page } for a new note (where you are now); `jump(note)` goes to one.
export function bindNotesList(root, store, { here = () => ({ position: 0 }), jump = null } = {}) {
  let filter = "all";
  let editing = null; // id of the item being edited
  let undo = null; // { note, timer } for the item just deleted

  root.innerHTML = `<div class="notes-list">
    <form class="note-composer">
      <textarea rows="2" placeholder="Write a note… (Enter to add, Shift+Enter for a new line)" aria-label="New note"></textarea>
      <button class="button small">Add</button>
    </form>
    <div class="note-filter" role="group" aria-label="Show"></div>
    <div class="note-items" aria-live="polite"></div>
  </div>`;
  const composer = root.querySelector(".note-composer");
  const box = composer.querySelector("textarea");
  const list = root.querySelector(".note-items");
  const filterBar = root.querySelector(".note-filter");

  let limit = PAGE; // notes shown; "Show more" adds a page
  const draw = () => {
    const items = store.items;
    const used = COLORS.filter((c) => items.some((n) => n.kind === "highlight" && n.color === c));
    filterBar.hidden = !used.length;
    filterBar.innerHTML = [["all", "All"], ["note", "Notes"], ...used.map((c) => [c, ""])].map(([value, label]) =>
      `<button type="button" data-filter="${value}" class="${filter === value ? "active" : ""}"
        ${label ? "" : `aria-label="${value} highlights" title="${value[0].toUpperCase() + value.slice(1)} highlights"`}>
        ${label || `<span class="hl-dot hl-${value}"></span>`}</button>`).join("");
    const shown = items.filter((n) => filter === "all" || (filter === "note" ? !!n.body : n.kind === "highlight" && n.color === filter));
    list.innerHTML = (undo ? `<div class="note-undo">Deleted. <button type="button" class="link" data-act="undo">Undo</button></div>` : "")
      + (shown.length ? shown.slice(0, limit).map(item).join("") + moreButton(shown.length - limit) : `<p class="hint note-empty">${items.length
        ? "Nothing here with this filter."
        : "Select text in the paper and pick a colour to highlight it, or write a note above."}</p>`);
    if (editing) list.querySelector(`[data-id="${editing}"] textarea`)?.focus();
  };

  const item = (n) => {
    const isEditing = editing === n.id;
    const goes = jump ? ` data-act="jump" role="button" tabindex="0" title="Go to this place"` : "";
    return `<article class="note-item ${n.kind === "highlight" ? `is-highlight hl-${n.color}` : ""}" data-id="${n.id}">
      ${n.source === "ai" ? `<span class="ai-mark" title="Added by the AI (Deep mode)">AI</span>` : ""}
      ${n.quote ? `<blockquote class="note-quote"${goes}>${esc(n.quote)}</blockquote>` : ""}
      ${isEditing ? `<textarea class="note-edit" rows="3" placeholder="${n.kind === "highlight" ? "Add a note to this highlight…" : ""}">${esc(n.body)}</textarea>
          <div class="note-actions"><button type="button" class="button small" data-act="save">Save</button>
          <button type="button" class="button quiet small" data-act="cancel">Cancel</button></div>`
        : n.body ? `<p class="note-body">${esc(n.body)}</p>`
        : `<button type="button" class="link note-add-body" data-act="edit">+ Add a note</button>`}
      ${isEditing ? "" : `<div class="note-foot">
        <span class="note-place"${goes}>${place(n)}</span>
        ${n.kind === "highlight" ? `<span class="note-colors" role="group" aria-label="Colour">${COLORS.map((c) =>
          `<button type="button" class="hl-dot hl-${c} ${c === n.color ? "active" : ""}" data-act="color" data-color="${c}" aria-label="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join("")}</span>` : ""}
        <span class="note-tools">${n.body ? `<button type="button" class="link" data-act="edit">Edit</button>` : ""}
        <button type="button" class="link danger" data-act="delete">Delete</button></span></div>`}
    </article>`;
  };

  const save = async (id) => {
    const text = list.querySelector(`[data-id="${id}"] textarea`).value.trim();
    const note = store.items.find((n) => n.id === id);
    editing = null;
    if (!text && note.kind === "note") return store.remove(id);
    if (text !== note.body) await store.edit(id, { body: text }).catch((e) => toast(e.message));
    else draw();
  };

  composer.onsubmit = async (e) => {
    e.preventDefault();
    const body = box.value.trim();
    if (!body) return box.focus();
    try {
      await store.add({ body, ...here() });
      box.value = "";
    } catch (err) { toast(err.message); }
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
  });
  filterBar.onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (b) { filter = b.dataset.filter; draw(); }
  };
  const act = async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const id = Number(el.closest("[data-id]")?.dataset.id);
    const note = store.items.find((n) => n.id === id);
    switch (el.dataset.act) {
      case "jump": return jump?.(note);
      case "edit": editing = id; return draw();
      case "cancel": editing = null; return draw();
      case "save": return save(id);
      case "color": return note.color !== el.dataset.color && store.edit(id, { color: el.dataset.color });
      case "delete": {
        clearTimeout(undo?.timer);
        undo = { note, timer: setTimeout(() => { undo = null; draw(); }, 8000) };
        return store.remove(id).catch((err) => { undo = null; toast(err.message); });
      }
      case "undo": {
        const { note: old } = undo;
        clearTimeout(undo.timer);
        undo = null;
        const { kind, body, quote, color, page, position, anchor } = old;
        return store.add({ kind, body, quote, color, page, position, anchor }).catch((err) => toast(err.message));
      }
    }
  };
  list.addEventListener("click", act);
  list.addEventListener("click", (e) => { if (e.target.closest("[data-more]")) { limit += PAGE; draw(); } });
  list.addEventListener("keydown", (e) => {
    if (e.target.matches("textarea.note-edit")) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(Number(e.target.closest("[data-id]").dataset.id));
      if (e.key === "Escape") { editing = null; draw(); }
    } else if ((e.key === "Enter" || e.key === " ") && e.target.dataset.act === "jump") { e.preventDefault(); act(e); }
  });

  const off = store.on(draw);
  draw();
  return {
    // Open the editor for one item (e.g. right after "Highlight and add a note").
    edit(id) { editing = id; filter = "all"; draw(); list.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" }); },
    focusNew() { box.focus(); },
    destroy: off,
  };
}
