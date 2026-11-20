// Figures to play with: a quiz on where a figure's parts are (Recall), two papers' figures side by side with the
// parts that are the same thing in the same colour, and a goal's ideas as a map (goal page).
// The parts of a figure come from the AI looking at it once (papers/figure_parts.py); boxes are grid cells,
// columns A–J and rows 1–10, as everywhere else.
import { api, esc, loading } from "./core.js";
import { plural } from "./pages/shared.js";

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

// ---------- Two figures side by side ----------
const PAIR = ["#3d5fd6", "#e07a2e", "#8a5cd6", "#d14b6a", "#9a6b3c", "#c9a227"]; // no green: it means "done" elsewhere

export function compareFigures(root, papers) {
  const withPdf = papers.filter((p) => p.has_pdf);
  if (withPdf.length < 2) { root.innerHTML = ""; return; }
  const pick = (side, chosen) => `<div class="fc-pick"><label for="fc-paper-${side}">${side === "a" ? "First" : "Second"} paper</label>
    <select id="fc-paper-${side}" data-side="${side}">${withPdf.map((p) => `<option value="${p.id}" ${p.id === chosen ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select>
    <select id="fc-fig-${side}" aria-label="Figure"><option>Loading figures…</option></select></div>`;
  root.innerHTML = `<section class="page-section fc">
    <h2>Compare two figures</h2>
    <p class="hint">Put a figure from one paper next to one from another. The AI finds each figure's parts and colours the
      parts that are the same thing alike, even when the papers name them differently.</p>
    <div class="fc-picks">${pick("a", withPdf[0].id)}${pick("b", withPdf[1].id)}</div>
    <button type="button" class="button" id="fc-go">Compare</button>
    <div class="fc-out"></div></section>`;
  const figuresOf = {};
  const fill = async (side) => {
    const id = Number(root.querySelector(`#fc-paper-${side}`).value);
    const select = root.querySelector(`#fc-fig-${side}`);
    select.innerHTML = "<option>Loading figures…</option>";
    const list = (figuresOf[id] ??= await api(`/papers/${id}/figures`).catch(() => []));
    select.innerHTML = list.length ? list.map((f) => `<option value="${f.kind}:${f.number}">${f.kind === "table" ? "Table" : "Figure"} ${f.number}: ${esc(f.caption.replace(/^\s*(fig(ure)?|table)\.?\s*\d+\s*[:.]\s*/i, "").slice(0, 60))}</option>`).join("")
      : "<option value=''>No figures found in this PDF</option>";
  };
  fill("a"); fill("b");
  root.addEventListener("change", (e) => { if (e.target.dataset.side) fill(e.target.dataset.side); });
  root.querySelector("#fc-go").onclick = async (e) => {
    const side = (s) => {
      const [kind, number] = (root.querySelector(`#fc-fig-${s}`).value || ":").split(":");
      return { paper_id: Number(root.querySelector(`#fc-paper-${s}`).value), kind, number: Number(number) };
    };
    const first = side("a"), second = side("b");
    const out = root.querySelector(".fc-out");
    if (!first.number || !second.number) { out.innerHTML = `<p class="hint">Pick a figure on each side.</p>`; return; }
    e.target.disabled = true;
    out.innerHTML = loading("The AI looks at both figures and matches their parts");
    try {
      const r = await api("/figures/compare", { method: "POST", json: { first, second } });
      out.innerHTML = comparison(r);
      bindLight(out);
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    finally { e.target.disabled = false; }
  };
}

function comparison({ sides, pairs }) {
  const colourOf = sides.map(() => ({}));
  pairs.forEach((p, i) => { colourOf[0][p.a] = i; colourOf[1][p.b] = i; });
  const frame = (s, k) => `<figure class="fc-side">
      <div class="fc-frame"><img src="${s.url}" alt="${esc(s.caption)}">
        ${s.parts.map((p, j) => { const b = area(p); const i = colourOf[k][j];
          return b ? `<span class="fc-box${i == null ? " is-alone" : ""}" ${i == null ? "" : `data-pair="${i}" style="--pair:${PAIR[i % PAIR.length]};${boxStyle(b)}"`}
            ${i == null ? `style="${boxStyle(b)}"` : ""} title="${esc(p.label)}"></span>` : ""; }).join("")}</div>
      <figcaption><a class="paper-name" href="#/papers/${s.paper_id}">${esc(s.title)}</a>
        <span class="faint">${s.kind === "table" ? "Table" : "Figure"} ${s.number} · page ${s.page}</span></figcaption></figure>`;
  return `<div class="fc-sides">${sides.map(frame).join("")}</div>
    ${pairs.length ? `<ul class="fc-pairs">${pairs.map((p, i) => `<li data-pair="${i}" style="--pair:${PAIR[i % PAIR.length]}">
      <i aria-hidden="true"></i><strong>${esc(p.same || "The same part")}</strong>
      <span class="faint">${esc(sides[0].parts[p.a].label)} ↔ ${esc(sides[1].parts[p.b].label)}</span></li>`).join("")}</ul>`
    : `<p class="hint">The AI found no parts that play the same role in both figures.</p>`}
    <p class="hint">${plural(pairs.length, "matching part")}; grey dashed boxes have no counterpart.</p>`;
}

function bindLight(out) {
  const light = (i) => {
    out.querySelectorAll("[data-pair]").forEach((el) => el.classList.toggle("is-lit", i != null && el.dataset.pair === i));
    out.classList.toggle("has-lit", i != null);
  };
  out.onmouseover = (e) => light(e.target.closest("[data-pair]")?.dataset.pair ?? null);
  out.onmouseout = () => light(null);
}

// ---------- A goal's ideas, as a map ----------
export function ideaMap(root, topicId, paperCount) {
  if (paperCount < 2) { root.innerHTML = ""; return; }
  root.innerHTML = `<section class="page-section im">
    <div class="section-bar"><h2>How the ideas connect</h2>
      <button type="button" class="button quiet" id="im-make" hidden>Map them again</button></div>
    <p class="hint">The main ideas across this goal's papers, from the basics to the most advanced; an arrow means one
      builds on the other. The numbers say which papers each idea comes from.</p>
    <div class="im-out">${loading()}</div></section>`;
  const out = root.querySelector(".im-out"), again = root.querySelector("#im-make");
  const draw = async (map) => {
    if (!map?.diagram) {
      out.innerHTML = `<div class="im-empty"><button type="button" class="button secondary" id="im-first">Map the ideas</button>
        <span class="hint">The AI reads each paper's key points; it takes a few seconds.</span></div>`;
      out.querySelector("#im-first").onclick = make;
      again.hidden = true;
      return;
    }
    const { renderAnswer, drawVisuals } = await import("./chat/render.js");
    out.innerHTML = `<div class="sheet im-sheet">${renderAnswer("```diagram\n" + map.diagram + "\n```")}</div>
      <ol class="im-papers">${map.papers.map((p) => `<li value="${p.n}"><a class="paper-name" href="#/papers/${p.id}">${esc(p.title)}</a></li>`).join("")}</ol>`;
    await drawVisuals(out);
    again.hidden = false;
  };
  const make = async () => {
    out.innerHTML = loading("Reading the papers' key points and how they connect");
    try { await draw(await api(`/topics/${topicId}/idea-map`, { method: "POST" })); }
    catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  again.onclick = make;
  api(`/topics/${topicId}/idea-map`).then(draw).catch(() => draw(null));
}
