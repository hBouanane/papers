// Map: which paper led you to which, drawn as chains of paper cards.
import { api, app, empty, esc, loading } from "../core.js";
import { cover, drawCovers } from "../covers.js";
import { paperCard, plural, shorten } from "./shared.js";

// ---------- Map ----------
// Behind the Map: one of your papers, big, half of it in the bottom-right corner, with dashed lines flowing
// out of it across the page to soft dots, like references leading to other papers.
const MAP_RAYS = [[6, 70], [16, 34], [38, 10], [30, 56], [60, 6], [10, 12]];

function mapBackdrop(papers, children, trees) {
  const p = trees.find((t) => t.has_pdf) || papers.find((x) => x.has_pdf && x.status === "reading")
    || papers.find((x) => x.has_pdf) || trees[0] || papers[0];
  if (!p) return "";
  const from = [80, 74];
  const rays = MAP_RAYS.map(([x, y], i) => {
    const c1 = [from[0] - 18, from[1] + (y - from[1]) * 0.15], c2 = [x + (from[0] - x) * 0.35, y];
    return `<path d="M${from[0]} ${from[1]} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${x} ${y}" style="--i:${i}"/>`;
  });
  const dots = MAP_RAYS.map(([x, y], i) => `<span class="map-dot" style="left:${x}%;top:${y}%;--i:${i}"></span>`);
  return `<div class="map-corner" aria-hidden="true">
    <svg class="map-rays" viewBox="0 0 100 100" preserveAspectRatio="none">${rays.join("")}</svg>${dots.join("")}
    <span class="map-corner-paper">${cover(p, "large")}</span></div>`;
}

export async function mapPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const papers = await api("/papers");
  if (stale()) return;
  const byId = Object.fromEntries(papers.map((p) => [p.id, p]));
  const children = {};
  papers.forEach((p) => { if (byId[p.source_paper_id]) (children[p.source_paper_id] ||= []).push(p); });
  const roots = papers.filter((p) => !byId[p.source_paper_id]);
  const trees = roots.filter((p) => children[p.id]);
  const loose = roots.filter((p) => !children[p.id]);

  // A chain drawn as a map: the same paper cards as everywhere, joined left to right by dashed arrows to
  // the papers each one led you to.
  // When a paper led to more than three, the first three show and the rest fold behind "+N more".
  const FOLD = 3;
  const node = (p) => {
    const kids = children[p.id] || [];
    const more = kids.length - FOLD;
    return `<li>${paperCard(p)}${kids.length ? `<ol class="${more > 0 ? "folded" : ""}">${kids.map((k, i) =>
      node(k).replace("<li>", `<li class="${i >= FOLD ? "chain-extra" : ""}">`)).join("")}
      ${more > 0 ? `<li class="chain-more"><button type="button" class="link" data-unfold>+${more} more</button></li>` : ""}</ol>` : ""}</li>`;
  };
  const size = (p) => 1 + (children[p.id] || []).reduce((n, c) => n + size(c), 0);
  const readIn = (p) => (p.status === "read" ? 1 : 0) + (children[p.id] || []).reduce((n, c) => n + readIn(c), 0);
  const chain = (t) => `<section class="chain">
      <p class="chain-head">Started from <strong class="paper-name">${esc(shorten(t.title, 70))}</strong>
        <span class="faint">· ${plural(size(t), "paper")}, ${readIn(t)} read</span></p>
      <div class="chain-scroll"><ol class="chain-tree">${node(t)}</ol></div></section>`;

  app.innerHTML = `${mapBackdrop(papers, children, trees)}<div class="container page map-page">
    <div class="page-head">
      <h1 class="page-title">Map</h1>
      <p class="lede">Which paper led you to which. Open a paper's references and pick one to grow a chain.</p>
    </div>
    ${trees.length ? trees.map(chain).join("")
      : empty("No chains yet. They appear when you follow a reference from one paper to another.")}
    ${loose.length ? `<section class="section"><h2>Not linked to other papers</h2>
      <p class="hint">Open one's References and pick a paper from them to start a chain.</p>
      <div class="shelf goal-shelf">${loose.map((p) => paperCard(p)).join("")}</div></section>` : ""}
  </div>`;
  drawCovers(app);
  app.addEventListener("click", (e) => {
    const unfold = e.target.closest("[data-unfold]");
    if (!unfold) return;
    const list = unfold.closest("ol");
    list.classList.remove("folded");
    unfold.closest("li").remove();
    drawCovers(list);
  });
}
