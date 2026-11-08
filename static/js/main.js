import { addFromLink, app, currentGoal, esc, looksLikePaperLink, setBar, showShortcuts, toast, uploadPdfs } from "./core.js";
import { goalPage, goalsPage, libraryPage, mapPage, recallPage, settingsPage } from "./pages.js";
import { paperPage, quizPage, readerPage } from "./paper.js";
import "./theme.js";

const routes = [
  [/^\/$/, libraryPage, "library"],
  [/^\/goals$/, goalsPage, "goals"],
  [/^\/goals\/(\d+)$/, goalPage, "goals"],
  [/^\/papers\/(\d+)$/, paperPage, "library"],
  [/^\/papers\/(\d+)\/read$/, readerPage, "library"],
  [/^\/papers\/(\d+)\/quiz$/, quizPage, "library"],
  [/^\/recall$/, recallPage, "recall"],
  [/^\/map$/, mapPage, "map"],
  [/^\/settings$/, settingsPage, "settings"],
];

let cleanup = null;
let renderId = 0;

async function render() {
  const path = location.hash.slice(1) || "/";
  const id = ++renderId;
  cleanup?.();
  cleanup = null;
  document.body.classList.remove("reading");
  setBar();
  const match = routes.find(([re]) => re.test(path));
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === match?.[2]));
  if (!match) {
    app.innerHTML = `<div class="container page"><h1>Not found</h1><p><a href="#/">Back to your library</a></p></div>`;
    return;
  }
  const [re, page] = match;
  const params = path.match(re).slice(1).map(Number);
  // A page can bail out if the user navigated away while it was loading.
  const stale = () => id !== renderId;
  window.scrollTo(0, 0);
  try {
    cleanup = (await page(...params, stale)) || null;
  } catch (e) {
    if (!stale()) app.innerHTML = `<div class="container page"><h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p></div>`;
  }
}

window.addEventListener("hashchange", render);
render();

// ---------- Capture from anywhere ----------
const typing = (el) => el?.closest?.("input, textarea, select, [contenteditable]");

// Paste a paper link (or a copied PDF file) anywhere outside a text box to add it.
document.addEventListener("paste", async (e) => {
  if (typing(e.target)) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type === "application/pdf");
  const text = e.clipboardData?.getData("text") || "";
  if (!files.length && !looksLikePaperLink(text)) return;
  e.preventDefault();
  toast(files.length ? "Adding the pasted PDF…" : "Adding the paper from that link…");
  try {
    const paper = files.length ? (await uploadPdfs(files, currentGoal())).added[0] : await addFromLink(text, currentGoal());
    if (paper) location.hash = `#/papers/${paper.id}`;
  } catch (err) { toast(err.message); }
});

// "/" searches the library from anywhere; "?" lists shortcuts; Escape closes the list.
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("shortcuts")?.remove();
    document.querySelectorAll("details.menu[open], details.add-paper[open]").forEach((d) => (d.open = false));
  }
  if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "/") {
    e.preventDefault();
    const focusSearch = () => document.getElementById("q")?.focus();
    if (document.getElementById("q")) focusSearch();
    else { location.hash = "#/"; setTimeout(focusSearch, 400); }
  } else if (e.key === "?" && !document.body.classList.contains("reading")) {
    showShortcuts();
  }
});

// Drop PDFs anywhere on the window.
const dropZone = document.getElementById("drop-zone");
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; dropZone.hidden = false; } });
addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; dropZone.hidden = true; } });
addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("drop", async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropZone.hidden = true;
  const pdfs = [...e.dataTransfer.files].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) return toast("Only PDF files can be added.");
  const { added, errors } = await uploadPdfs(pdfs, currentGoal(), toast);
  if (errors.length) toast(errors.join(" "));
  else if (added.length === 1) location.hash = `#/papers/${added[0].id}`;
  else { toast(`Added ${added.length} papers.`); render(); }
});

// Menus close when you click anywhere outside them.
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.menu[open], details.add-paper[open]").forEach((d) => {
    if (!d.contains(e.target)) d.open = false;
  });
});
