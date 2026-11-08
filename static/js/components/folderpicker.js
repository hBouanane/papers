// Choosing a folder for the library. First the system's own folder dialog (opened by the app on this
// computer); where there is none (for example in Docker) an in-app browser of the folders on the server.
//
//   const path = await chooseFolder(startPath);   // full path, or null if cancelled
import { api, esc } from "../core.js";

export async function chooseFolder(start = "") {
  try {
    const { path } = await api("/folders/pick", { method: "POST", json: { start } });
    return path || null;
  } catch (err) {
    if (err.status !== 501) throw err;
    return browseFolders(start);
  }
}

// A dialog listing the folders inside one folder: click to go in, Up to go back, "Use this folder" to choose.
function browseFolders(start) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "folder-browser sheet";
    dialog.innerHTML = `<form method="dialog">
      <h2>Choose a folder</h2>
      <div class="fb-path"><button type="button" class="button secondary small" data-up title="Up one folder">↑ Up</button>
        <input class="fb-where" aria-label="Folder path" spellcheck="false"></div>
      <div class="fb-roots"></div>
      <ul class="fb-list" role="listbox"></ul>
      <div class="form-foot"><button value="cancel" class="button secondary">Cancel</button>
        <button value="ok" class="button" data-use>Use this folder</button></div></form>`;
    document.body.append(dialog);
    const where = dialog.querySelector(".fb-where");
    const list = dialog.querySelector(".fb-list");
    let here = null;

    const go = async (path) => {
      try {
        here = await api(`/folders?path=${encodeURIComponent(path)}`);
      } catch (err) {
        list.innerHTML = `<li class="fb-note">${esc(err.message)}</li>`;
        return;
      }
      where.value = here.path;
      dialog.querySelector("[data-up]").disabled = !here.parent;
      dialog.querySelector(".fb-roots").innerHTML = [here.home, ...here.roots].map((r) =>
        `<button type="button" class="chip-button" data-go="${esc(r)}">${r === here.home ? "Home" : esc(r)}</button>`).join("");
      list.innerHTML = here.folders.length
        ? here.folders.map((f) => `<li><button type="button" data-in="${esc(f)}"><span class="fb-icon" aria-hidden="true"></span>${esc(f)}</button></li>`).join("")
        : `<li class="fb-note">No folders inside. You can use this one, or type a new path above: it's created when you save.</li>`;
    };
    const join = (a, b) => a.replace(/[\\/]+$/, "") + (a.includes("\\") ? "\\" : "/") + b;

    dialog.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.in) go(join(here.path, t.dataset.in));
      else if (t.dataset.go) go(t.dataset.go);
      else if ("up" in t.dataset && here?.parent) go(here.parent);
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
