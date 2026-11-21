// The figure quiz (Recall): where are a figure's parts?
// The parts of a figure come from the AI looking at it once (papers/figure_parts.py); boxes are grid cells,
// columns A–J and rows 1–10, as everywhere else.
import { api, esc, loading } from "./core.js";

const CELL = /^([A-Ja-j])(10|[1-9])$/;
// A part's box as fractions of the figure {x, y, w, h}, or null.
export function area(part) {
  const a = CELL.exec(String(part.from || "").trim()), z = CELL.exec(String(part.to || part.from || "").trim());
  if (!a || !z) return null;
  const col = (m) => m[1].toUpperCase().charCodeAt(0) - 65, row = (m) => Number(m[2]) - 1;
  const c0 = Math.min(col(a), col(z)), c1 = Math.max(col(a), col(z)), r0 = Math.min(row(a), row(z)), r1 = Math.max(row(a), row(z));
  return { x: c0 / 10, y: r0 / 10, w: (c1 - c0 + 1) / 10, h: (r1 - r0 + 1) / 10 };
}
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const boxStyle = (b) => `left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}`;
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map(([, v]) => v);

// ---------- The figure quiz ----------
// "Click the decoder": the figure without its boxes; a click within a cell of the part counts.
export function figureQuiz(root) {
  root.innerHTML = `<section class="page-section fq">
    <h2>Figure quiz</h2>
    <p class="hint">A figure from a paper you're reading or have read, without its labels' help: find its parts. Good for
      remembering how a method fits together.</p>
    <div class="fq-stage"><button type="button" class="button" data-fq="start">Quiz me on a figure</button></div></section>`;
  const stage = root.querySelector(".fq-stage");
  let shown = "";
  const start = async () => {
    stage.innerHTML = loading("Picking a figure and finding its parts (the first time, the AI looks at it)");
    let fig;
    try { fig = await api(`/figure-quiz?skip=${encodeURIComponent(shown)}`); }
    catch (err) {
      stage.innerHTML = `<p class="hint">${esc(err.message)}</p>
        ${err.status === 404 ? "" : `<button type="button" class="button secondary" data-fq="start">Try again</button>`}`;
      return;
    }
    shown = `${fig.paper_id}:${fig.number}`;
    const parts = shuffle(fig.parts.map((p) => ({ ...p, box: area(p) })).filter((p) => p.box));
    let at = 0, right = 0, answered = false;
    stage.innerHTML = `<p class="fq-from">Figure ${fig.number} of <a class="paper-name" href="#/papers/${fig.paper_id}">${esc(fig.title)}</a></p>
      <p class="fq-ask" aria-live="polite"></p>
      <div class="fq-frame"><img src="${fig.url}" alt="${esc(fig.caption)}"><div class="fq-marks"></div></div>
      <div class="fq-foot"><span class="fq-score hint"></span><button type="button" class="button secondary" data-fq="next" hidden>Next</button></div>`;
    const ask = stage.querySelector(".fq-ask"), marks = stage.querySelector(".fq-marks"), next = stage.querySelector('[data-fq="next"]');
    const show = () => {
      answered = false;
      marks.innerHTML = "";
      next.hidden = true;
      ask.innerHTML = `Click <strong>${esc(parts[at].label)}</strong> <span class="faint">(${at + 1} of ${parts.length})</span>`;
      stage.querySelector(".fq-score").textContent = at ? `${right} of ${at} so far` : "";
    };
    stage.querySelector(".fq-frame").onclick = (e) => {
      if (answered) return;
      const r = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height, b = parts[at].box;
      const near = 0.05; // half a cell of slack around the part: the boxes are drawn on a coarse grid
      const hit = x >= b.x - near && x <= b.x + b.w + near && y >= b.y - near && y <= b.y + b.h + near;
      answered = true;
      right += hit ? 1 : 0;
      marks.innerHTML = `<span class="fq-box ${hit ? "is-right" : "is-wrong"}" style="${boxStyle(b)}"></span>
        <span class="fq-dot" style="left:${pct(x)};top:${pct(y)}"></span>`;
      ask.innerHTML = hit ? `Yes, that's <strong>${esc(parts[at].label)}</strong>.` : `Not quite: <strong>${esc(parts[at].label)}</strong> is in the box.`;
      at += 1;
      if (at < parts.length) { next.hidden = false; next.textContent = "Next"; next.focus(); return; }
      stage.querySelector(".fq-score").textContent = "";
      ask.insertAdjacentHTML("beforeend", ` <span class="fq-total">You found ${right} of ${parts.length}.</span>`);
      next.hidden = false;
      next.textContent = "Another figure";
      next.dataset.fq = "start";
    };
    next.onclick = () => { if (next.dataset.fq === "next") show(); };
    show();
  };
  root.addEventListener("click", (e) => { if (e.target.closest('[data-fq="start"]')) start(); });
}

