// Choosing a folder for the library, in the app's own folder browser (the same on every system, and in Docker).
// Shortcuts to your usual folders and drives, the folders inside the one you're in, Up, and New folder.
//
//   const path = await chooseFolder(startPath);   // full path, or null if cancelled
import { api, esc } from "../core.js";

const ICONS = {
  Home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  Desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  Documents: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  Downloads: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M5 13l2-8h10l2 8M17 16.5h.01"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.drive}</svg>`;

export function chooseFolder(start = "") {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "folder-browser sheet";
    dialog.innerHTML = `<form method="dialog">
      <h2>Choose a folder</h2>
      <div class="fb-places" role="group" aria-label="Places"></div>
      <div class="fb-path"><button type="button" class="button secondary small" data-up title="Up one folder">↑ Up</button>
        <input class="fb-where" aria-label="Folder path" spellcheck="false"></div>
      <ul class="fb-list" role="listbox" aria-label="Folders"></ul>
      <div class="fb-foot"><button type="button" class="button secondary" data-new>+ New folder</button>
        <span class="fb-gap"></span>
        <button value="cancel" class="button secondary">Cancel</button>
        <button value="ok" class="button" data-use>Use this folder</button></div></form>`;
    document.body.append(dialog);
    const where = dialog.querySelector(".fb-where");
    const list = dialog.querySelector(".fb-list");
    let here = null;

    const go = async (path) => {
      try {
        here = await api(`/folders?path=${encodeURIComponent(path)}`);
      } catch (err) {
        list.innerHTML = `<li class="fb-note error">${esc(err.message)}</li>`;
        return;
      }
      where.value = here.path;
      dialog.querySelector("[data-up]").disabled = !here.parent;
      dialog.querySelector(".fb-places").innerHTML = here.places.map((p) =>
        `<button type="button" class="fb-place${samePath(p.path, here.path) ? " active" : ""}" data-go="${esc(p.path)}">${icon(p.name)}${esc(p.name)}</button>`).join("");
      list.innerHTML = here.folders.length
        ? here.folders.map((f) => `<li><button type="button" data-in="${esc(f)}"><span class="fb-icon" aria-hidden="true"></span>${esc(f)}</button></li>`).join("")
        : `<li class="fb-note">No folders inside. Use this one, or make a new one.</li>`;
      list.scrollTop = 0;
    };
    const samePath = (a, b) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
    const join = (a, b) => a.replace(/[\\/]+$/, "") + (a.includes("\\") ? "\\" : "/") + b;

    // A row at the top of the list to name the new folder; Enter makes it and opens it.
    const newFolder = () => {
      if (list.querySelector(".fb-new")) return list.querySelector(".fb-new input").focus();
      list.querySelector(".fb-note")?.remove();
      list.insertAdjacentHTML("afterbegin", `<li class="fb-new"><span class="fb-icon" aria-hidden="true"></span>
        <input placeholder="New folder name" aria-label="New folder name" maxlength="120"><span class="fb-new-hint">Enter to create</span></li>`);
      const input = list.querySelector(".fb-new input");
      input.focus();
      input.addEventListener("keydown", async (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); go(here.path); }
        if (e.key !== "Enter") return;
        e.preventDefault();
        try {
          const { path } = await api("/folders", { method: "POST", json: { path: here.path, name: input.value } });
          go(path);
        } catch (err) {
          list.querySelector(".fb-new-hint").textContent = err.message;
          list.querySelector(".fb-new").classList.add("bad");
        }
      });
    };

    dialog.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.in) go(join(here.path, t.dataset.in));
      else if (t.dataset.go) go(t.dataset.go);
      else if ("up" in t.dataset && here?.parent) go(here.parent);
      else if ("new" in t.dataset) newFolder();
    });
    where.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); go(where.value); }
    });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok" ? where.value.trim() || null : null);
      dialog.remove();
    });
    dialog.showModal();
    go(start);
  });
}
