import { app, esc } from "./core.js";
import { goalPage, goalsPage, libraryPage, mapPage, recallPage, settingsPage } from "./pages.js";
import { paperPage, quizPage, readerPage } from "./paper.js";

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
