// Map: which paper led you to which, drawn as chains of paper cards.
import { api, app, empty, esc, loading } from "../core.js";
import { cover, drawCovers } from "../covers.js";
import { paperCard, plural, shorten } from "./shared.js";
import { firstPaper, sampleCover, sampleTitle } from "./welcome.js";

// ---------- Map ----------
// Behind the Map: two of your papers, big, half out of the corners (bottom right and top right, tilted
// opposite ways). Dashed lines flow out from under the bottom one across the page, like references leading to
// others; it lies on top of the other one, which sits a little deeper.
// Points are in % of the backdrop (it fills the page under the header, right side).
const FROM = [80, 80];
const RAYS = [[-12, 78], [0, 44], [26, 22], [16, 64], [48, 40], [-6, 16]];

// Each line fades out along its length: strongest where it leaves the paper, gone at its end.
const curve = ([x, y], i) => {
  const c1 = [FROM[0] - 18, FROM[1] + (y - FROM[1]) * 0.15], c2 = [x + (FROM[0] - x) * 0.35, y];
  return `<linearGradient id="ray-${i}" gradientUnits="userSpaceOnUse" x1="${FROM[0]}" y1="${FROM[1]}" x2="${x}" y2="${y}">
      <stop offset="0" class="ray-stop"/><stop offset=".55" class="ray-stop" stop-opacity=".55"/><stop offset="1" class="ray-stop" stop-opacity="0"/></linearGradient>
    <path d="M${FROM[0]} ${FROM[1]} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${x} ${y}" stroke="url(#ray-${i})" style="--i:${i}"/>`;
};

function mapBackdrop(papers, children, trees) {
  const withPdf = papers.filter((x) => x.has_pdf);
  const low = trees.find((t) => t.has_pdf) || withPdf.find((x) => x.status === "reading") || withPdf[0] || trees[0] || papers[0];
  if (!low) return "";
  // a different paper for the top corner, ideally one the first led to
  const high = withPdf.find((x) => x.id !== low.id && (children[low.id] || []).some((c) => c.id === x.id))
    || withPdf.find((x) => x.id !== low.id) || papers.find((x) => x.id !== low.id);
  return `<div class="map-corner" aria-hidden="true">
    <svg class="map-rays" viewBox="0 0 100 100" preserveAspectRatio="none">${RAYS.map(curve).join("")}</svg>
    <span class="map-corner-paper">${cover(low, "large")}</span>
    ${high ? `<span class="map-corner-paper map-corner-high">${cover(high, "large")}</span>` : ""}</div>`;
}

// With no papers yet: the same corner and lines with stand-in papers, and an example of a chain.
function emptyMap() {
  const card = (i) => `<span class="shelf-card sample-card"><span class="shelf-stage" aria-hidden="true">${sampleCover(i)}</span>
    <span class="shelf-info"><span class="shelf-title paper-name">${sampleTitle(i)}</span></span></span>`;
  return `<div class="map-corner" aria-hidden="true">
    <svg class="map-rays" viewBox="0 0 100 100" preserveAspectRatio="none">${RAYS.map(curve).join("")}</svg>
    <span class="map-corner-paper">${sampleCover(0, "large")}</span>
    <span class="map-corner-paper map-corner-high">${sampleCover(1, "large")}</span></div>
  <div class="container page map-page">
    <div class="page-head">
      <h1 class="page-title">Map</h1>
      <p class="lede">Which paper led you to which. Open a paper's references and pick one to grow a chain.</p>
    </div>
    ${firstPaper("Your map starts with one paper", "Add a paper, open its References and pick one from them. The two get joined here, and the chain grows as you follow more.")}
    <section class="chain chain-example" aria-label="An example chain">
      <p class="chain-head"><span class="chain-label">Example</span> One paper leads to two more, and one of those to another.</p>
      <div class="chain-scroll"><ol class="chain-tree"><li>${card(0)}<ol><li>${card(1)}<ol><li>${card(2)}</li></ol></li><li>${card(2)}</li></ol></li></ol></div>
    </section>
  </div>`;
}

export async function mapPage(stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const papers = await api("/papers");
  if (stale()) return;
  if (!papers.length) { app.innerHTML = emptyMap(); return; }
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
