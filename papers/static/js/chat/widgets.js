// Interactive visuals the model can put in an answer (```widget blocks), for any field: a physics set-up, a growth
// curve, a market, a distribution, a reaction rate. The model gives data and math expressions; nothing it writes
// runs as code. Expressions are evaluated by math.js with its powerful functions turned off. Kinds:
//   plot     curves y = f(x) (or x(t), y(t)), with moving points, shaded areas and marker lines
//   scene    a free drawing in x, y coordinates: circles, rectangles, lines, arrows, points, text, curves, polygons,
//            each placed by expressions (and repeated over a counter), so it moves with the sliders
//   bars     bars whose heights are expressions (a distribution, shares, a comparison that changes)
//   circles  dials: one circle per expression, each hand at an angle
//   heatmap  a grid of values f(row, col), hover to read a value
//   steps    a walkthrough: one step at a time, Back / Next
// Every kind takes "params" (sliders; "play": true adds a play button), "let" (named values worked out from the
// sliders, usable in every expression) and "outputs" (numbers shown under the picture, live). Text may hold
// {expressions} in braces.
import { esc } from "../core.js";
import { icon } from "../icons.js";

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
const compiled = new Map();
const fnOf = (expr) => {
  if (typeof expr === "number") return () => expr;
  const key = String(expr);
  if (!compiled.has(key)) compiled.set(key, compile(key));
  return compiled.get(key);
};
// The value of an expression (or a plain number) with these variables
const val = (expr, scope, fallback = 0) => (expr == null || expr === "" ? fallback : fnOf(expr)(scope));

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COLORS = () => [css("--ink") || "#1d3fbb", "#e2a33b", "#3a9a6e", "#c0504d", "#8a6fd1", "#4fa3c7"];
const NAMED = { blue: 0, orange: 1, yellow: 1, green: 2, red: 3, purple: 4, cyan: 5, teal: 5 };
const colorOf = (c, i) => (c === "muted" || c === "gray" || c === "grey" ? css("--pencil") : c === "text" || c === "black" ? css("--graphite")
  : COLORS()[(((typeof c === "number" ? c - 1 : NAMED[c] ?? i) % 6) + 6) % 6]);
const fixed = (v, digits) => v.toFixed(Math.min(Math.max(+digits || 0, 0), 8));
// with digits asked for, a small value that would round to 0 is shown in full instead ("0.00014", not "0.00")
const fmt = (v, digits) => (!Number.isFinite(v) ? "–" : digits != null && (v === 0 || +fixed(v, digits) !== 0) ? fixed(v, digits)
  : Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(1) : Math.abs(v) < 1 ? String(+v.toPrecision(3)) : String(+v.toFixed(Math.abs(v) < 100 ? 2 : 1)));
// "F = {m * a} N": the expressions in braces, worked out
const fill = (text, scope) => String(text ?? "").replace(/\{([^{}]+)\}/g, (_, e) => { try { return fmt(fnOf(e)(scope)); } catch { return "?"; } });
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const span = (r = {}) => { // the values of a counter {name, from, to, step}
  const a = +r.from || 0, b = +(r.to ?? 10), step = Math.abs(+r.step) || 1, out = [];
  for (let k = a; k <= b + 1e-9 && out.length < 200; k += step) out.push(+k.toFixed(10));
  return out;
};
const ok = (...n) => n.every(Number.isFinite);
// about five ticks on round numbers (0, 25 000, 50 000… rather than 1, 25 000.75…)
const ticks = (a, b) => {
  const raw = (b - a) / 4, unit = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].find((m) => m * unit >= raw * .8) * unit, out = [];
  if (!(step > 0)) return [a];
  for (let t = Math.ceil(a / step - 1e-9) * step; t <= b + step * 1e-9 && out.length < 9; t += step) out.push(Math.abs(t) < step * 1e-6 ? 0 : +t.toPrecision(12));
  return out;
};
// drawings are as wide as the place they are shown in, so their text stays the same size in the narrow panel
const widthOf = (stage) => clamp(Math.round(stage.getBoundingClientRect().width) || 560, 300, 760);

// Sliders for parameters [{name, from, to, step, value, label, unit, play}]; calls draw(scope) on every change.
function sliders(box, params, draw) {
  params = (params || []).filter((p) => p?.name).slice(0, 8);
  const scope = Object.fromEntries(params.map((p) => [p.name, Number(p.value ?? p.from ?? 0)]));
  const unit = Object.fromEntries(params.map((p) => [p.name, p.unit ? ` ${p.unit}` : ""]));
  box.innerHTML = params.map((p) => `<label class="widget-slider"><span class="widget-param">${p.play
    ? `<button type="button" class="widget-play" data-play="${esc(p.name)}" data-seconds="${+p.seconds || 6}" title="Play" aria-label="Play">${icon("play", 13)}</button>` : ""}${esc(p.label || p.name)}</span>
      <input type="range" min="${+p.from || 0}" max="${+(p.to ?? 10)}" step="${p.step ?? (Number.isInteger(+p.from || 0) && Number.isInteger(+(p.to ?? 10)) && (p.to ?? 10) - (+p.from || 0) >= 8 ? 1 : ((p.to ?? 10) - (+p.from || 0)) / 100)}"
        value="${scope[p.name]}" data-param="${esc(p.name)}"><output>${esc(fmt(scope[p.name]) + unit[p.name])}</output></label>`).join("");
  box.addEventListener("input", (e) => {
    const name = e.target.dataset.param;
    if (!name) return;
    scope[name] = Number(e.target.value);
    e.target.nextElementSibling.textContent = fmt(scope[name]) + unit[name];
    draw(scope);
  });
  // Play: the slider runs through its range, again and again, until Pause (or the answer is gone)
  const playing = new Set();
  box.addEventListener("click", (e) => {
    const button = e.target.closest("[data-play]");
    if (!button) return;
    e.preventDefault();
    const input = [...box.querySelectorAll("input[data-param]")].find((i) => i.dataset.param === button.dataset.play);
    const on = !playing.has(input);
    button.innerHTML = icon(on ? "pause" : "play", 13);
    button.title = on ? "Pause" : "Play";
    button.setAttribute("aria-label", button.title);
    if (!on) return void playing.delete(input);
    playing.add(input);
    const lo = +input.min, hi = +input.max, every = (+button.dataset.seconds || 6) * 1000;
    let v = +input.value >= hi ? lo : +input.value, last = performance.now();
    const tick = (now) => {
      if (!playing.has(input) || !box.isConnected) return;
      v += (hi - lo) * (now - last) / every;
      last = now;
      if (v > hi) v = lo;
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return scope;
}

// Sliders and live numbers under a picture. paint(scope) redraws it; scope has the sliders' values and the "let" ones.
function live(stage, spec, paint) {
  stage.insertAdjacentHTML("beforeend", `<div class="widget-outputs" hidden></div><div class="widget-sliders"></div>`);
  const lets = Array.isArray(spec.let) ? spec.let.map((l) => [l.name, l.expr]) : Object.entries(spec.let || {});
  const outputs = (spec.outputs || []).slice(0, 8);
  const box = stage.querySelector(".widget-outputs");
  box.hidden = !outputs.length;
  const run = (values) => {
    const scope = { ...values };
    for (const [name, expr] of lets) scope[name] = fnOf(expr)(scope);
    paint(scope);
    box.innerHTML = outputs.map((o) => `<div class="widget-output"><span>${esc(fill(o.label, scope))}</span>
      <b>${esc(o.expr != null ? fmt(val(o.expr, scope), o.digits) : fill(o.text, scope))}${o.unit ? `<small> ${esc(o.unit)}</small>` : ""}</b></div>`).join("");
  };
  run(sliders(stage.querySelector(".widget-sliders"), spec.params || (spec.param ? [spec.param] : []), run));
}

// ---------- plot ----------
function plot(stage, spec) {
  const W = widthOf(stage), H = Math.round(clamp(W * .5, 200, 300)), pad = { l: 46, r: 14, t: 12, b: 34 };
  const x0 = +spec.x?.from || 0, x1 = +(spec.x?.to ?? 10), n = clamp(+spec.samples || 200, 20, 600);
  const lines = (spec.lines || []).slice(0, 8).map((l, i) => ({ ...l, color: colorOf(l.color, i) }));
  const areas = (spec.areas || []).slice(0, 6), points = (spec.points || []).slice(0, 12);
  const marks = [...(spec.vlines || []).slice(0, 6).map((m) => ({ ...m, v: true })), ...(spec.hlines || []).slice(0, 6)];
  stage.innerHTML = `<svg class="widget-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || "Plot")}"></svg>
    <div class="widget-legend">${lines.filter((l) => l.label !== "").map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label || l.expr || "")}</span>`).join("")}</div>`;
  const svg = stage.querySelector("svg");
  const curve = (l, scope, a = x0, b = x1) => Array.from({ length: n + 1 }, (_, k) => {
    if (l.x != null && l.y != null) { // x(t), y(t)
      const t = +(l.t?.from ?? 0) + (+(l.t?.to ?? 1) - +(l.t?.from ?? 0)) * k / n;
      return [val(l.x, { ...scope, t }), val(l.y, { ...scope, t })];
    }
    const x = a + (b - a) * k / n;
    return [x, val(l.expr, { ...scope, x })];
  }).filter(([x, y]) => ok(x, y));
  live(stage, spec, (scope) => {
    const pts = lines.map((l) => curve(l, scope));
    const dots = points.map((p) => [val(p.x, scope), val(p.y, scope)]);
    const ys = [...pts.flat(), ...dots.filter((d) => ok(...d))].map(([, y]) => y);
    let y0 = +(spec.y?.from ?? Math.min(...ys, 0)), y1 = +(spec.y?.to ?? Math.max(...ys, 0));
    if (!ok(y0, y1) || y0 === y1) { y0 = (y0 || 0) - 1; y1 = (y1 || 0) + 1; }
    const sx = (x) => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r);
    const sy = (y) => H - pad.b - (clamp(y, y0 - (y1 - y0), y1 + (y1 - y0)) - y0) / (y1 - y0) * (H - pad.t - pad.b);
    const grid = css("--line"), muted = css("--pencil"), text = css("--graphite");
    const path = (p) => p.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
    svg.innerHTML = `<defs><clipPath id="plot-clip"><rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}"/></clipPath></defs>
      ${ticks(y0, y1).map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="${grid}"/>
        <text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      ${ticks(x0, x1).map((t) => `<text x="${sx(t) > W - 22 ? W - 2 : sx(t)}" y="${H - pad.b + 16}" text-anchor="${sx(t) > W - 22 ? "end" : "middle"}" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      <text x="${(W + pad.l) / 2}" y="${H - 4}" text-anchor="middle" fill="${muted}" font-size="12">${esc(spec.x?.label || "x")}</text>
      ${spec.y?.label ? `<text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" fill="${muted}" font-size="12">${esc(spec.y.label)}</text>` : ""}
      <g clip-path="url(#plot-clip)">
      ${areas.map((a, i) => { // the area between a curve and zero, from one x to another
    const from = clamp(val(a.from, scope, x0), x0, x1), to = clamp(val(a.to, scope, x1), x0, x1);
    const p = curve(a, scope, Math.min(from, to), Math.max(from, to));
    return p.length < 2 ? "" : `<polygon fill="${colorOf(a.color, i)}" fill-opacity=".2" points="${sx(p[0][0]).toFixed(1)},${sy(0).toFixed(1)} ${path(p)} ${sx(p.at(-1)[0]).toFixed(1)},${sy(0).toFixed(1)}"/>`;
  }).join("")}
      ${pts.map((p, i) => `<polyline fill="none" stroke="${lines[i].color}" stroke-width="2.2" stroke-linejoin="round" ${lines[i].dash ? `stroke-dasharray="6 5"` : ""}
        points="${path(p)}"/>`).join("")}
      ${marks.map((m) => {
    const at = val(m.v ? m.x ?? m.at : m.y ?? m.at, scope);
    if (!ok(at)) return "";
    return m.v ? `<line x1="${sx(at)}" x2="${sx(at)}" y1="${pad.t}" y2="${H - pad.b}" stroke="${muted}" stroke-dasharray="4 4"/>`
      : `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(at)}" y2="${sy(at)}" stroke="${muted}" stroke-dasharray="4 4"/>`;
  }).join("")}</g>
      ${marks.map((m) => {
    const at = val(m.v ? m.x ?? m.at : m.y ?? m.at, scope);
    if (!ok(at) || !m.label) return "";
    return m.v ? `<text x="${clamp(sx(at) + 5, pad.l, W - 60)}" y="${pad.t + 11}" fill="${muted}" font-size="11">${esc(fill(m.label, scope))}</text>`
      : `<text x="${W - pad.r - 4}" y="${sy(at) - 5}" text-anchor="end" fill="${muted}" font-size="11">${esc(fill(m.label, scope))}</text>`;
  }).join("")}
      ${dots.map(([x, y], i) => (!ok(x, y) || x < x0 || x > x1 ? "" : `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="5" fill="${colorOf(points[i].color, i + lines.length)}" stroke="${css("--sheet")}" stroke-width="1.5"/>
        ${points[i].label ? `<text x="${sx(x) > W - 130 ? sx(x) - 9 : sx(x) + 9}" y="${sy(y) - 8}" text-anchor="${sx(x) > W - 130 ? "end" : "start"}" fill="${text}" font-size="11.5" font-weight="700">${esc(fill(points[i].label, scope))}</text>` : ""}`)).join("")}`;
  });
}

// ---------- scene: a drawing that moves with the sliders ----------
function scene(stage, spec) {
  const W = widthOf(stage), axes = !!spec.axes, pad = axes ? { l: 42, r: 12, t: spec.y?.label ? 24 : 12, b: 30 } : { l: 10, r: 10, t: 10, b: 10 };
  const x0 = +(spec.x?.from ?? -10), x1 = +(spec.x?.to ?? 10), y0 = +(spec.y?.from ?? -10), y1 = +(spec.y?.to ?? 10);
  const inner = W - pad.l - pad.r;
  const tall = clamp(spec.equal === false ? Math.min(280, inner * .6) : inner * (y1 - y0) / (x1 - x0), 120, 440), H = Math.round(tall + pad.t + pad.b);
  const sx = (x) => pad.l + (x - x0) / (x1 - x0) * inner, sy = (y) => pad.t + (y1 - y) / (y1 - y0) * tall;
  const len = (v) => Math.abs(v) * inner / (x1 - x0), tallOf = (v) => Math.abs(v) * tall / (y1 - y0);
  const shapes = (spec.shapes || []).slice(0, 60);
  stage.innerHTML = `<svg class="widget-scene" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || "Drawing")}"></svg>`;
  const svg = stage.querySelector("svg");
  const one = (sh, i, s) => {
    const color = colorOf(sh.color, i), text = css("--graphite");
    const stroke = `stroke="${color}" stroke-width="${clamp(+sh.width || 2, .5, 12)}" stroke-linecap="round" stroke-linejoin="round"${sh.dash ? ` stroke-dasharray="6 5"` : ""}`;
    const inside = sh.fill ? `fill="${color}" fill-opacity="${sh.fill === "solid" ? 1 : .18}"` : `fill="none"`;
    const say = (x, y, anchor = "middle") => (sh.label == null ? "" : `<text x="${(anchor === "middle" ? clamp(x, pad.l + 34, W - pad.r - 34) : x).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${text}" font-size="12" font-weight="600">${esc(fill(sh.label, s))}</text>`);
    const group = (body) => (sh.opacity == null ? body : `<g opacity="${clamp(val(sh.opacity, s, 1), 0, 1)}">${body}</g>`);
    switch (sh.shape) {
      case "circle": {
        const cx = sx(val(sh.x, s)), cy = sy(val(sh.y, s)), r = len(val(sh.r, s, 1));
        return ok(cx, cy, r) ? group(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" ${inside} ${stroke}/>${say(cx, cy - r - 6)}`) : "";
      }
      case "point": {
        const cx = sx(val(sh.x, s)), cy = sy(val(sh.y, s));
        return ok(cx, cy) ? group(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${clamp(+sh.size || 5, 1.5, 14)}" fill="${color}"/>${say(cx + 9, cy - 7, "start")}`) : "";
      }
      case "rect": { // x, y: its lower-left corner
        const x = val(sh.x, s), y = val(sh.y, s), w = val(sh.w, s, 1), h = val(sh.h, s, 1);
        if (!ok(x, y, w, h)) return "";
        const X = sx(Math.min(x, x + w)), Y = sy(Math.max(y, y + h));
        return group(`<rect x="${X.toFixed(1)}" y="${Y.toFixed(1)}" width="${len(w).toFixed(1)}" height="${tallOf(h).toFixed(1)}" rx="${clamp(+sh.round || 0, 0, 30)}" ${inside} ${stroke}/>
          ${say(X + len(w) / 2, sh.fill && tallOf(h) > 24 ? Y + tallOf(h) / 2 + 4 : Y - 6)}`);
      }
      case "line": case "arrow": {
        const a = sx(val(sh.x1, s)), b = sy(val(sh.y1, s)), c = sx(val(sh.x2, s)), d = sy(val(sh.y2, s));
        if (!ok(a, b, c, d)) return "";
        const angle = Math.atan2(d - b, c - a), tip = (t) => `${(c - 10 * Math.cos(angle + t)).toFixed(1)},${(d - 10 * Math.sin(angle + t)).toFixed(1)}`;
        const head = sh.shape === "arrow" && Math.hypot(c - a, d - b) > 4 ? `<polygon points="${c.toFixed(1)},${d.toFixed(1)} ${tip(.42)} ${tip(-.42)}" fill="${color}"/>` : "";
        return group(`<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" ${stroke}/>${head}
          ${Math.abs(Math.cos(angle)) < .5 ? say((a + c) / 2 + 9, (b + d) / 2 + 4, "start") : say((a + c) / 2, (b + d) / 2 - 9)}`);
      }
      case "text": {
        const x = sx(val(sh.x, s)), y = sy(val(sh.y, s));
        return ok(x, y) ? group(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${["start", "end"].includes(sh.anchor) ? sh.anchor : "middle"}" fill="${sh.color ? color : text}"
          font-size="${clamp(+sh.size || 13, 9, 28)}" font-weight="${sh.bold ? 800 : 500}">${esc(fill(sh.text ?? sh.label, s))}</text>`) : "";
      }
      case "curve": {
        const k = 120, from = sh.x != null ? +(sh.t?.from ?? 0) : val(sh.from, s, x0), to = sh.x != null ? +(sh.t?.to ?? 1) : val(sh.to, s, x1);
        const p = Array.from({ length: k + 1 }, (_, j) => {
          const t = from + (to - from) * j / k;
          return sh.x != null ? [sx(val(sh.x, { ...s, t })), sy(val(sh.y, { ...s, t }))] : [sx(t), sy(val(sh.expr, { ...s, x: t }))];
        }).filter((q) => ok(...q));
        return p.length < 2 ? "" : group(`<polyline points="${p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ")}" ${inside} ${stroke}/>${say(p.at(-1)[0] - 6, p.at(-1)[1] - 8, "end")}`);
      }
      case "polygon": {
        const p = (sh.points || []).slice(0, 40).map((q) => [sx(val(q?.[0], s)), sy(val(q?.[1], s))]);
        return p.length < 2 || !p.every((q) => ok(...q)) ? "" : group(`<polygon points="${p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ")}" ${inside} ${stroke}/>
          ${say(p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length + 4)}`);
      }
      default:
        throw new Error(`Unknown shape "${sh.shape}". Shapes: circle, point, rect, line, arrow, text, curve, polygon.`);
    }
  };
  live(stage, spec, (scope) => {
    const grid = css("--line"), muted = css("--pencil");
    let drawn = 0;
    const body = shapes.map((sh, i) => (sh.repeat ? span(sh.repeat).map((k) => ({ ...scope, [sh.repeat.name || "k"]: k })) : [scope])
      .map((s) => (drawn++ < 600 ? one(sh, i, s) : "")).join("")).join("");
    svg.innerHTML = `${axes ? `${ticks(y0, y1).map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="${grid}"/>
        <text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      ${ticks(x0, x1).map((t) => `<line x1="${sx(t)}" x2="${sx(t)}" y1="${pad.t}" y2="${pad.t + tall}" stroke="${grid}"/>
        <text x="${sx(t) > W - 22 ? W - 2 : sx(t)}" y="${pad.t + tall + 15}" text-anchor="${sx(t) > W - 22 ? "end" : "middle"}" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      ${spec.x?.label ? `<text x="${W - pad.r}" y="${H - 2}" text-anchor="end" fill="${muted}" font-size="11.5">${esc(spec.x.label)}</text>` : ""}
      ${spec.y?.label ? `<text x="4" y="11" fill="${muted}" font-size="11.5">${esc(spec.y.label)}</text>` : ""}` : ""}
      <defs><clipPath id="scene-clip-${H}"><rect x="${pad.l - 2}" y="${pad.t - 2}" width="${inner + 4}" height="${tall + 4}"/></clipPath></defs>
      <g clip-path="url(#scene-clip-${H})">${body}</g>`;
  });
}

// ---------- bars ----------
function bars(stage, spec) {
  const W = widthOf(stage), H = Math.round(clamp(W * .46, 190, 270)), pad = { l: 46, r: 10, t: 20, b: 42 };
  stage.innerHTML = `<svg class="widget-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || "Bars")}"></svg>`;
  const svg = stage.querySelector("svg");
  const name = spec.repeat?.name || "k";
  live(stage, spec, (scope) => {
    const list = spec.repeat ? span(spec.repeat).slice(0, 80).map((k) => ({ label: spec.label != null ? fill(spec.label, { ...scope, [name]: k }) : fmt(k), v: val(spec.expr, { ...scope, [name]: k }) }))
      : (spec.bars || []).slice(0, 40).map((b) => ({ label: fill(b.label, scope), v: val(b.expr ?? b.value, scope), color: b.color }));
    const vs = list.map((b) => b.v).filter(Number.isFinite);
    let y0 = +(spec.y?.from ?? Math.min(0, ...vs)), y1 = +(spec.y?.to ?? Math.max(0, ...vs));
    if (!ok(y0, y1) || y0 === y1) y1 = y0 + 1;
    const sy = (y) => H - pad.b - (clamp(y, y0, y1) - y0) / (y1 - y0) * (H - pad.t - pad.b);
    const slot = (W - pad.l - pad.r) / Math.max(list.length, 1), wide = Math.min(slot * .72, 64), every = Math.ceil(list.length / 16);
    const grid = css("--line"), muted = css("--pencil"), text = css("--graphite");
    svg.innerHTML = `${ticks(y0, y1).map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="${grid}"/>
        <text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end" fill="${muted}" font-size="11">${fmt(t)}</text>`).join("")}
      ${list.map((b, i) => {
    if (!ok(b.v)) return "";
    const x = pad.l + slot * i + (slot - wide) / 2, top = Math.min(sy(b.v), sy(0)), tall = Math.abs(sy(b.v) - sy(0));
    return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${wide.toFixed(1)}" height="${Math.max(tall, 1).toFixed(1)}" rx="2.5" fill="${colorOf(b.color, spec.repeat ? 0 : i)}"/>
        ${list.length <= 8 || (list.length <= 14 && b.v === Math.max(...vs)) ? `<text x="${(x + wide / 2).toFixed(1)}" y="${(b.v >= 0 ? top - 5 : top + tall + 13).toFixed(1)}" text-anchor="middle" fill="${text}" font-size="11" font-weight="700">${fmt(b.v)}</text>` : ""}
        ${i % every ? "" : `<text x="${(x + wide / 2).toFixed(1)}" y="${H - pad.b + 15}" text-anchor="middle" fill="${muted}" font-size="11">${esc(String(b.label).slice(0, 14))}</text>`}`;
  }).join("")}
      ${spec.x?.label ? `<text x="${(W + pad.l) / 2}" y="${H - 5}" text-anchor="middle" fill="${muted}" font-size="12">${esc(spec.x.label)}</text>` : ""}
      ${spec.y?.label ? `<text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" fill="${muted}" font-size="12">${esc(spec.y.label)}</text>` : ""}`;
  });
}

// ---------- circles: dials ----------
function circles(stage, spec) {
  const items = (spec.circles || []).slice(0, 12).map((c, i) => ({ ...c, color: colorOf(c.color, i) }));
  const show = spec.show || "sincos"; // what to print under each dial: "sincos", "degrees", "turns" or "none"
  stage.innerHTML = `<div class="widget-circles">${items.map((c, i) => `<figure class="widget-circle">
      <svg viewBox="-60 -60 120 120" aria-hidden="true"><circle r="50" fill="none" stroke="${css("--line")}" stroke-width="2"/>
        <line x1="-50" x2="50" stroke="${css("--line")}" stroke-dasharray="2 4"/><line y1="-50" y2="50" stroke="${css("--line")}" stroke-dasharray="2 4"/>
        <line class="hand" data-i="${i}" x2="46" stroke="${c.color}" stroke-width="4" stroke-linecap="round"/>
        <circle class="tip" data-i="${i}" r="5" fill="${c.color}"/></svg>
      <figcaption>${esc(c.label || `#${i + 1}`)}<span class="widget-readout" data-i="${i}"></span></figcaption></figure>`).join("")}</div>`;
  live(stage, spec, (scope) => items.forEach((c, i) => {
    const a = val(c.angle, scope);
    const x = Math.cos(a) * 46, y = -Math.sin(a) * 46; // counter-clockwise, like the unit circle
    stage.querySelector(`.hand[data-i="${i}"]`).setAttribute("x2", x.toFixed(2));
    stage.querySelector(`.hand[data-i="${i}"]`).setAttribute("y2", y.toFixed(2));
    stage.querySelector(`.tip[data-i="${i}"]`).setAttribute("cx", x.toFixed(2));
    stage.querySelector(`.tip[data-i="${i}"]`).setAttribute("cy", y.toFixed(2));
    const turn = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    stage.querySelector(`.widget-readout[data-i="${i}"]`).textContent = c.readout != null ? ` ${fill(c.readout, scope)}`
      : show === "sincos" ? ` sin ${fmt(Math.sin(a))} · cos ${fmt(Math.cos(a))}` : show === "degrees" ? ` ${fmt(turn * 180 / Math.PI, 0)}°`
        : show === "turns" ? ` ${fmt(a / (2 * Math.PI), 2)} turns` : "";
  }));
}

// ---------- heatmap ----------
function heatmap(stage, spec) {
  const r = spec.rows || {}, c = spec.cols || {};
  const rows = Math.min(Math.max(1, (+r.to || 10) - (+r.from || 0) + 1), 200), cols = Math.min(Math.max(1, (+c.to || 10) - (+c.from || 0) + 1), 200);
  stage.innerHTML = `<div class="widget-heat"><canvas width="${cols}" height="${rows}"></canvas>
      <div class="widget-heat-axes"><span>${esc(c.label || c.name || "column")} →</span><span>↓ ${esc(r.label || r.name || "row")}</span></div>
      <p class="widget-readout faint">Point at a cell to read its value.</p></div>`;
  const canvas = stage.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  let values = [];
  canvas.addEventListener("mousemove", (e) => {
    const b = canvas.getBoundingClientRect();
    const j = Math.floor((e.clientX - b.left) / b.width * cols), i = Math.floor((e.clientY - b.top) / b.height * rows);
    const v = values[i]?.[j];
    if (v != null) stage.querySelector(".widget-readout").textContent =
      `${r.label || r.name || "row"} ${(+r.from || 0) + i}, ${c.label || c.name || "column"} ${(+c.from || 0) + j}: ${fmt(v)}`;
  });
  live(stage, spec, (scope) => {
    values = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) =>
      val(spec.expr, { ...scope, [r.name || "row"]: (+r.from || 0) + i, [c.name || "col"]: (+c.from || 0) + j })));
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
  });
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

const KINDS = { plot, scene, bars, circles, heatmap, steps };

export async function drawWidget(stage, spec, ctx = {}) {
  const draw = KINDS[spec.type];
  if (!draw) throw new Error(`Unknown widget "${spec.type}". Widgets: ${Object.keys(KINDS).join(", ")}.`);
  stage.classList.add("widget");
  stage.innerHTML = `${spec.title ? `<p class="widget-title">${esc(spec.title)}</p>` : ""}<div class="widget-body"></div>
    ${spec.caption ? `<p class="widget-caption">${esc(spec.caption)}</p>` : ""}`;
  draw(stage.querySelector(".widget-body"), spec, ctx);
}
