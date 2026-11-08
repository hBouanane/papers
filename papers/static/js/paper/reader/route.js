// The pill above the paper that says where you are: where you came from › the paper › Reading.
import { api, cameFrom, esc } from "../../core.js";

const ORIGIN = { "/": "Library", "/goals": "Goals", "/recall": "Recall", "/map": "Map", "/settings": "Settings" };

export function setupRoute(r) {
  const { id, paper: p } = r;
  const origin = cameFrom(`/papers/${id}`) || "/";
  const label = ORIGIN[origin] || (/^\/goals\/\d+$/.test(origin) ? "Goal" : /^\/papers\/\d+$/.test(origin) ? "Previous paper" : "Library");
  r.$("#route").innerHTML = `<a href="#${ORIGIN[origin] || /^\/(goals|papers)\/\d+$/.test(origin) ? origin : "/"}" data-origin>${esc(label)}</a>
      <span aria-hidden="true">›</span><a href="#/papers/${id}" class="route-paper" title="${esc(p.title)}">${esc(p.title)}</a><span aria-hidden="true">›</span><span>Reading</span>`;
  // Opened from a goal: name the goal once it's known.
  if (/^\/goals\/\d+$/.test(origin)) api("/topics").then((goals) => {
    const g = goals.find((x) => `/goals/${x.id}` === origin);
    if (g) r.$$("[data-origin]").forEach((a) => (a.textContent = g.goal));
  }).catch(() => {});
}
