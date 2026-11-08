// A searchable dropdown: a button showing the current choice; clicking it opens a list with a search box.
// Type to filter, arrows to move, Enter to choose, Escape to close. When `allowCustom` is set and nothing
// matches, the typed text itself can be chosen.
//
//   combobox(container, { options: [{ value, label, hint }], value, placeholder, onPick(value) })
import { esc } from "../core.js";

export function combobox(container, { options, value = "", placeholder = "Choose…", allowCustom = false, onPick }) {
  container.classList.add("combo");
  container.innerHTML = `
    <button type="button" class="combo-button" aria-haspopup="listbox" aria-expanded="false">
      <span class="combo-current"></span><span class="combo-caret" aria-hidden="true"></span></button>
    <div class="combo-pop sheet" hidden>
      <input class="combo-search" type="search" placeholder="Search" aria-label="Search" autocomplete="off">
      <ul class="combo-list" role="listbox"></ul>
    </div>`;
  const button = container.querySelector(".combo-button");
  const pop = container.querySelector(".combo-pop");
  const search = container.querySelector(".combo-search");
  const list = container.querySelector(".combo-list");
  let current = value;
  let shown = [];
  let active = 0;

  const labelOf = (v) => options.find((o) => o.value === v) || (v ? { value: v, label: v } : null);
  const paintButton = () => {
    const o = labelOf(current);
    container.querySelector(".combo-current").innerHTML = o
      ? `${esc(o.label)}${o.hint ? ` <span class="combo-hint">${esc(o.hint)}</span>` : ""}`
      : `<span class="combo-hint">${esc(placeholder)}</span>`;
  };

  const paintList = () => {
    const q = search.value.trim().toLowerCase();
    shown = options.filter((o) => !q || `${o.label} ${o.hint || ""} ${o.value}`.toLowerCase().includes(q));
    if (allowCustom && q && !shown.length) {
      shown.push({ value: search.value.trim(), label: `Use “${search.value.trim()}”`, custom: true });
    }
    active = Math.max(0, Math.min(active, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((o, i) => `<li role="option" data-i="${i}"
        class="${i === active ? "active" : ""} ${o.value === current ? "chosen" : ""}" aria-selected="${o.value === current}">
        <span>${esc(o.label)}</span>${o.hint ? `<span class="combo-hint">${esc(o.hint)}</span>` : ""}</li>`).join("")
      : `<li class="combo-none">Nothing matches.</li>`;
    list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };

  const open = () => {
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    search.value = "";
    active = Math.max(0, options.findIndex((o) => o.value === current));
    paintList();
    search.focus();
  };
  const close = () => {
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const choose = (o) => {
    if (!o) return;
    current = o.value;
    paintButton();
    close();
    button.focus();
    onPick?.(current);
  };

  button.addEventListener("click", () => (pop.hidden ? open() : close()));
  search.addEventListener("input", () => { active = 0; paintList(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(shown.length, 1);
      paintList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Escape") {
      close();
      button.focus();
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the search box
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) choose(shown[+li.dataset.i]);
  });
  document.addEventListener("click", (e) => { if (!container.contains(e.target)) close(); });
  paintButton();
  return { get value() { return current; } };
}
