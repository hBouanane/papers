// Interactive visuals the model can put in an answer (```widget blocks). The model gives data and math
// expressions; nothing it writes runs as code. Expressions are evaluated by math.js with its powerful functions
// turned off. Kinds:
//   plot     curves y = f(x) with sliders for their parameters
//   circles  "clock hands": one circle per expression, each hand at an angle; a slider moves them all
//   heatmap  a grid of values f(row, col) (with sliders), hover to read a value
//   steps    a walkthrough: one step at a time, Back / Next (text, and an optional formula)
import { esc } from "../core.js";

const { create, all } = await import("https://cdn.jsdelivr.net/npm/mathjs@13.1.1/+esm");
const math = create(all);
// As math.js advises for untrusted expressions: keep compile, then take away what an expression could misuse
// (defining functions or units, evaluating text inside an expression, changing math.js itself).
const mathCompile = math.compile;
const blocked = () => { throw new Error("Not allowed in a widget"); };
math.import({ import: blocked, createUnit: blocked, evaluate: blocked, parse: blocked, simplify: blocked, derivative: blocked,
  resolve: blocked, reviver: blocked }, { override: true });
const compile = (expr) => {
  const code = mathCompile(String(expr));
  return (scope) => { const v = code.evaluate({ ...scope }); return typeof v === "number" ? v : Number(v); };
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COLORS = () => [css("--ink") || "#1d3fbb", "#e2a33b", "#3a9a6e", "#c0504d", "#8a6fd1", "#4fa3c7"];
const fmt = (v) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : +v.toFixed(3));

// Sliders for parameters [{name, from, to, step, value, label}]; calls draw(scope) on every change.
function sliders(box, params, draw) {
  const scope = Object.fromEntries((params || []).map((p) => [p.name, Number(p.value ?? p.from ?? 0)]));
  box.innerHTML = (params || []).map((p) => `<label class="widget-slider"><span class="widget-param">${esc(p.label || p.name)}</span>
      <input type="range" min="${+p.from}" max="${+p.to}" step="${p.step ?? (Number.isInteger(+p.from) && Number.isInteger(+p.to) ? 1 : (p.to - p.from) / 100)}"
        value="${scope[p.name]}" data-param="${esc(p.name)}"><output>${fmt(scope[p.name])}</output></label>`).join("");
  box.addEventListener("input", (e) => {
    const name = e.target.dataset.param;
    if (!name) return;
    scope[name] = Number(e.target.value);
    e.target.nextElementSibling.textContent = fmt(scope[name]);
    draw(scope);
  });
  return scope;
}

// ---------- plot ----------
function plot(stage, spec) {
  const W = 560, H = 260, pad = { l: 46, r: 14, t: 12, b: 34 };
  const x0 = +spec.x?.from || 0, x1 = +(spec.x?.to ?? 10), n = Math.min(+spec.samples || 200, 600);
  const lines = (spec.lines || []).map((l, i) => ({ ...l, fn: compile(l.expr), color: COLORS()[i % 6] }));
  stage.innerHTML = `<svg class="widget-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || "Plot")}"></svg>
    <div class="widget-legend">${lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label || l.expr)}</span>`).join("")}</div>
    <div class="widget-sliders"></div>`;
  const svg = stage.querySelector("svg");
  const draw = (scope) => {
    const pts = lines.map((l) => Array.from({ length: n + 1 }, (_, k) => {
      const x = x0 + (x1 - x0) * k / n;
      return [x, l.fn({ ...scope, x })];
    }).filter(([, y]) => Number.isFinite(y)));
    const ys = pts.flat().map(([, y]) => y);
    let y0 = spec.y?.from ?? Math.min(...ys, 0), y1 = spec.y?.to ?? Math.max(...ys, 0);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const sx = (x) => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r);
    const sy = (y) => H - pad.b - (y - y0) / (y1 - y0) * (H - pad.t - pad.b);
    const grid = css("--line"), muted = css("--pencil");
    // five ticks; values that are only floating-point noise away from 0 show as 0
    const ticks = (a, b) => Array.from({ length: 5 }, (_, i) => { const t = a + (b - a) * i / 4; return Math.abs(t) < Math.abs(b - a) * 1e-3 ? 0 : t; });
    svg.innerHTML = `
      ${ticks(y0, y1).map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="${grid}"/>
        <text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      ${ticks(x0, x1).map((t) => `<text x="${sx(t)}" y="${H - pad.b + 16}" text-anchor="middle" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      <text x="${(W + pad.l) / 2}" y="${H - 4}" text-anchor="middle" fill="${muted}" font-size="12">${esc(spec.x?.label || "x")}</text>
      ${spec.y?.label ? `<text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" fill="${muted}" font-size="12">${esc(spec.y.label)}</text>` : ""}
      ${pts.map((p, i) => `<polyline fill="none" stroke="${lines[i].color}" stroke-width="2.2" stroke-linejoin="round"
        points="${p.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")}"/>`).join("")}`;
  };
  draw(sliders(stage.querySelector(".widget-sliders"), spec.params, draw));
}

// ---------- circles ("clock hands") ----------
function circles(stage, spec) {
  const items = (spec.circles || []).slice(0, 12).map((c, i) => ({ ...c, fn: compile(c.angle), color: COLORS()[i % 6] }));
  stage.innerHTML = `<div class="widget-circles">${items.map((c, i) => `<figure class="widget-circle">
      <svg viewBox="-60 -60 120 120" aria-hidden="true"><circle r="50" fill="none" stroke="${css("--line")}" stroke-width="2"/>
        <line x1="-50" x2="50" stroke="${css("--line")}" stroke-dasharray="2 4"/><line y1="-50" y2="50" stroke="${css("--line")}" stroke-dasharray="2 4"/>
        <line class="hand" data-i="${i}" x2="46" stroke="${c.color}" stroke-width="4" stroke-linecap="round"/>
        <circle class="tip" data-i="${i}" r="5" fill="${c.color}"/></svg>
      <figcaption>${esc(c.label || `#${i + 1}`)}<span class="widget-readout" data-i="${i}"></span></figcaption></figure>`).join("")}</div>
    <div class="widget-sliders"></div>`;
  const draw = (scope) => items.forEach((c, i) => {
    const a = c.fn(scope);
    const x = Math.cos(a) * 46, y = -Math.sin(a) * 46; // counter-clockwise, like the unit circle
    stage.querySelector(`.hand[data-i="${i}"]`).setAttribute("x2", x.toFixed(2));
    stage.querySelector(`.hand[data-i="${i}"]`).setAttribute("y2", y.toFixed(2));
    stage.querySelector(`.tip[data-i="${i}"]`).setAttribute("cx", x.toFixed(2));
    stage.querySelector(`.tip[data-i="${i}"]`).setAttribute("cy", y.toFixed(2));
    stage.querySelector(`.widget-readout[data-i="${i}"]`).textContent = ` sin ${fmt(Math.sin(a))} · cos ${fmt(Math.cos(a))}`;
  });
  draw(sliders(stage.querySelector(".widget-sliders"), spec.params || (spec.param ? [spec.param] : []), draw));
}

// ---------- heatmap ----------
function heatmap(stage, spec) {
  const r = spec.rows || {}, c = spec.cols || {};
  const rows = Math.min(Math.max(1, (+r.to || 10) - (+r.from || 0) + 1), 200), cols = Math.min(Math.max(1, (+c.to || 10) - (+c.from || 0) + 1), 200);
  const fn = compile(spec.expr);
  stage.innerHTML = `<div class="widget-heat"><canvas width="${cols}" height="${rows}"></canvas>
      <div class="widget-heat-axes"><span>${esc(c.label || c.name || "column")} →</span><span>↓ ${esc(r.label || r.name || "row")}</span></div>
      <p class="widget-readout faint">Point at a cell to read its value.</p></div><div class="widget-sliders"></div>`;
  const canvas = stage.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  let values = [];
  const draw = (scope) => {
    values = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) =>
      fn({ ...scope, [r.name || "row"]: (+r.from || 0) + i, [c.name || "col"]: (+c.from || 0) + j })));
    const flat = values.flat().filter(Number.isFinite);
    const lo = Math.min(...flat), hi = Math.max(...flat);
    const img = ctx.createImageData(cols, rows);
    values.flat().forEach((v, k) => { // blue (low) → white → orange (high)
      const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      const [R, G, B] = t < 0.5 ? [29 + (255 - 29) * t * 2, 63 + (255 - 63) * t * 2, 187 + (255 - 187) * t * 2]
        : [255, 255 - (255 - 163) * (t - 0.5) * 2, 255 - (255 - 59) * (t - 0.5) * 2];
      img.data.set([R, G, B, 255], k * 4);
    });
    ctx.putImageData(img, 0, 0);
  };
  canvas.addEventListener("mousemove", (e) => {
    const b = canvas.getBoundingClientRect();
    const j = Math.floor((e.clientX - b.left) / b.width * cols), i = Math.floor((e.clientY - b.top) / b.height * rows);
    const v = values[i]?.[j];
    if (v != null) stage.querySelector(".widget-readout").textContent =
      `${r.label || r.name || "row"} ${(+r.from || 0) + i}, ${c.label || c.name || "column"} ${(+c.from || 0) + j}: ${fmt(v)}`;
  });
  draw(sliders(stage.querySelector(".widget-sliders"), spec.params, draw));
}

// ---------- steps ----------
function steps(stage, spec, ctx) {
  const list = (spec.steps || []).slice(0, 20);
  let at = 0;
  const show = () => {
    const s = list[at] || {};
    stage.innerHTML = `<div class="widget-steps"><p class="widget-step-count">Step ${at + 1} of ${list.length}</p>
        <h4>${esc(s.title || "")}</h4><div class="widget-step-body">${ctx.render ? ctx.render(s.text || "") : esc(s.text || "")}</div>
        <div class="widget-step-nav"><button type="button" class="button secondary small" data-go="-1" ${at ? "" : "disabled"}>Back</button>
          <button type="button" class="button small" data-go="1" ${at < list.length - 1 ? "" : "disabled"}>Next</button></div></div>`;
  };
  stage.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]")?.dataset.go;
    if (go) { at = Math.max(0, Math.min(list.length - 1, at + Number(go))); show(); }
  });
  show();
}

const KINDS = { plot, circles, heatmap, steps };

export async function drawWidget(stage, spec, ctx = {}) {
  const draw = KINDS[spec.type];
  if (!draw) throw new Error(`Unknown widget "${spec.type}". Widgets: ${Object.keys(KINDS).join(", ")}.`);
  stage.classList.add("widget");
  stage.innerHTML = `${spec.title ? `<p class="widget-title">${esc(spec.title)}</p>` : ""}<div class="widget-body"></div>
    ${spec.caption ? `<p class="widget-caption">${esc(spec.caption)}</p>` : ""}`;
  draw(stage.querySelector(".widget-body"), spec, ctx);
}
