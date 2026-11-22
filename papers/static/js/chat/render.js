// Drawing an answer: Markdown (tables, code, lists), math typeset with KaTeX, citations you can click ([§3.4],
// [Fig. 1], [Table 2], [p. 5]) and visuals the model describes in fenced blocks:
//   ```chart    a Vega-Lite spec (bar, line, scatter, heatmap) with its data inline
//   ```diagram  a Mermaid diagram (flowchart, sequence, ...)
//   ```math     {"tex": ..., "terms": [{"class": "t1", "symbol": ..., "meaning": ...}]}: a formula with its parts coloured and explained
//   ```figure   {"figure": 1} or {"table": 2}, with optional "boxes" [{x, y, w, h, label}] (fractions of the image)
//   ```compare  {"left": {figure, boxes}, "right": {paper, figure, boxes}, "pairs": [{left, right, same}]}: two figures
//   ```widget   an interactive visual (widgets.js)
// No code from the model runs: specs are data, drawn by these libraries. HTML is sanitised (DOMPurify).
//
//   renderAnswer(text, { streaming })  → HTML (visuals as placeholders)
//   drawVisuals(root, ctx)             → draws the placeholders in root (lazy-loads Mermaid and Vega once needed)
import { script, VENDOR } from "../vendor.js";
import { esc } from "../core.js";
import { iconButton } from "../icons.js";

const [{ Marked }, { default: DOMPurify }, { default: katex }] = await Promise.all([
  import(`${VENDOR}/marked/marked.esm.js`),
  import(`${VENDOR}/dompurify/purify.es.mjs`),
  import(`${VENDOR}/katex/katex.mjs`),
]).catch(() => [{}, {}, {}]); // a library missing: plain text rendering below still works
if (katex && !document.querySelector("link[data-katex]")) {
  document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" data-katex href="${VENDOR}/katex/katex.min.css">`);
}
const marked = Marked ? new Marked({ gfm: true, breaks: false }) : null;

export const VISUALS = ["chart", "diagram", "math", "figure", "compare", "widget", "page"];
const FENCE = new RegExp("```(" + VISUALS.join("|") + "|followups)[^\\n]*\\n([\\s\\S]*?)(```|$)", "g");
const KIND = { chart: "Chart", diagram: "Diagram", math: "Formula", figure: "Figure", compare: "Comparison", widget: "Interactive", page: "Interactive page" };

// Formulas: KaTeX, with \htmlClass{t1}{...} allowed so a formula's parts can be coloured to match their meanings.
const tex = (src, display) => {
  if (!katex) return `<code>${esc(src)}</code>`;
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore",
      trust: (c) => c.command === "\\htmlClass" && /^t[1-6]$/.test(c.class), output: "html" });
  } catch { return `<code>${esc(src)}</code>`; }
};

// [§3.4] [Fig. 1] [Figure 2] [Table 3] [p. 5] [pp. 4–5] → buttons that take you there. A bracket can hold several
// ([§3.1, §3.4]) or a reference with more words after it ([Table 3, row (E)]).
const REF = /^(§\s?[\d.]*\d[a-z]?|(?:Fig\.|Figure|Table|Eq\.|p\.|pp\.)\s?\d+(?:[–-]\d+)?)$/;
const CITE = /\[([^\[\]<>]{1,80})\]/g;
const citeKind = (ref) => (ref.startsWith("§") ? "section" : /^(Fig|Figure)/.test(ref) ? "figure" : ref.startsWith("Table") ? "table"
  : ref.startsWith("Eq") ? "equation" : "page");

// Right-to-left writing (Arabic, Persian, Urdu, Hebrew): an answer mostly in it is laid out right to left. Formulas,
// code and citations stay left to right inside it (chat.css), and each paragraph also takes its own direction.
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
export function isRightToLeft(text) {
  const words = String(text).replace(/```[\s\S]*?(```|$)/g, "").replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, "").replace(/\[[^\]]*\]/g, "");
  const rtl = (words.match(RTL_CHARS) || []).length;
  const latin = (words.match(/[A-Za-z]/g) || []).length;
  return rtl > 0 && rtl >= latin;
}

export function renderAnswer(text, { streaming = false } = {}) {
  const visuals = [];
  const maths = [];
  // 1. visual blocks out (a block still being written shows as a placeholder that says so)
  let src = text.replace(FENCE, (_, kind, body, end) => {
    if (kind === "followups") return "";
    visuals.push({ kind, body: body.trim(), complete: end === "```" && !streaming });
    return `\n\n@@VISUAL${visuals.length - 1}@@\n\n`;
  });
  // 2. math out, so Markdown doesn't touch it: $$...$$, \[...\], then $...$, \(...\)
  const keep = (display) => (_, m) => { maths.push(tex(m, display)); return `@@MATH${maths.length - 1}@@`; };
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, keep(true)).replace(/\\\[([\s\S]+?)\\\]/g, keep(true))
    .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (m, pre, body) => pre + keep(false)(m, body))
    .replace(/\\\(([\s\S]+?)\\\)/g, keep(false));
  // 3. Markdown, sanitised; then citations, math and visual placeholders back in
  let html = marked ? DOMPurify.sanitize(marked.parse(src)) : `<p>${esc(src).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  html = html.replace(CITE, (whole, inside) => {
    const parts = inside.split(/\s*[,;]\s*/);
    if (!REF.test(parts[0])) return whole; // [13] and other brackets stay as they are
    return parts.map((part) => (REF.test(part)
      ? `<button type="button" class="cite" data-cite="${citeKind(part)}" data-ref="${part}">${part}</button>` : part)).join(" ");
  });
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => maths[+i]);
  html = html.replace(/(?:<p>)?@@VISUAL(\d+)@@(?:<\/p>)?/g, (_, i) => {
    const v = visuals[+i];
    if (!v.complete) {
      return `<div class="visual visual-pending"><span class="visual-kind">${KIND[v.kind]}</span><span class="faint">Drawing…</span></div>`;
    }
    return `<figure class="visual visual-${v.kind}" data-visual="${v.kind}" data-spec="${esc(v.body)}">
      <div class="visual-stage"></div>
      ${iconButton("expand", "Open it large", { cls: "visual-open", size: 15 })}</figure>`;
  });
  return isRightToLeft(text) ? `<div class="answer-rtl" dir="rtl">${html}</div>` : html;
}

// A visual's JSON, read leniently: models sometimes leave text after the closing brace, or write LaTeX with single
// backslashes (\frac instead of \\frac), which JSON would turn into control characters or reject.
export function looseJSON(text) {
  const object = (src) => { // the first complete {...}, whatever comes before or after it
    const start = src.indexOf("{");
    if (start < 0) throw new Error("The visual's description is missing.");
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error("The visual's description is incomplete.");
  };
  // \frac, \beta, \theta, \vec... in JSON become a form feed, a backspace, a tab: a sign the LaTeX wasn't escaped
  const garbled = (v) => (typeof v === "string" ? /[\b\f\t\v]/.test(v) : v && typeof v === "object" && Object.values(v).some(garbled));
  const src = object(String(text));
  try {
    const value = JSON.parse(src);
    if (!garbled(value)) return value;
  } catch { /* single backslashes before LaTeX commands: fixed below */ }
  return JSON.parse(src.replace(/(?<!\\)\\(?=[a-zA-Z]{2,})/g, "\\\\"));
}

// ---------- Drawing the visuals ----------
let mermaidReady = null;
let vegaReady = null;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => document.documentElement.dataset.theme === "dark" || document.documentElement.dataset.theme === "dim"
  || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

const loadMermaid = () => (mermaidReady ??= script("mermaid/mermaid.min.js").then(() => globalThis.mermaid));
const loadVega = () => (vegaReady ??= script("vega/vega.min.js").then(() => script("vega/vega-lite.min.js"))
  .then(() => script("vega/vega-embed.min.js")).then(() => globalThis.vegaEmbed));
let diagrams = 0;

// The branches of mind maps and other diagrams with sections: soft colours that read on the page (Mermaid's own
// turn black on a dark page). No green: it means "done" everywhere else in Papers.
function branches() {
  const fills = dark() ? ["#2b3a6b", "#5a3d24", "#47306b", "#5c2a3c", "#4a3b2a", "#5a4a1c"]
    : ["#dfe6fb", "#fbe5d3", "#ebe0fb", "#fbdfe7", "#efe6da", "#f8efcf"];
  const vars = {};
  for (let i = 0; i < 12; i++) {
    vars[`cScale${i}`] = fills[i % fills.length];
    vars[`cScaleLabel${i}`] = css("--heading");
    vars[`cScalePeer${i}`] = css("--ink");
    vars[`cScaleInv${i}`] = css("--ink"); // the line under a branch's label (Mermaid's own is green for some)
  }
  return vars;
}

// Two (or more) things compared, each in its own box with nothing linking them: put them side by side as columns.
// Mermaid stacks unlinked boxes one under the other in a left-to-right chart, which made comparisons tall and tiny.
export function sideBySide(code) {
  const lines = code.split("\n");
  const head = lines.findIndex((l) => l.trim() && !l.trim().startsWith("%%"));
  if (head < 0 || !/^\s*(flowchart|graph)\s+(LR|RL|TB|TD|BT)?\s*$/i.test(lines[head])) return code;
  let depth = 0, groups = 0, linked = false;
  for (const line of lines.slice(head + 1)) {
    const t = line.trim();
    if (/^subgraph\b/.test(t)) { if (depth === 0) groups++; depth++; continue; }
    if (t === "end") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /(--|==|-\.)/.test(t)) linked = true;
  }
  if (groups < 2 || linked) return code;
  depth = 0;
  return [...lines.slice(0, head), lines[head].replace(/(flowchart|graph)\s*\S*\s*$/i, "$1 TB"), ...lines.slice(head + 1).flatMap((line) => {
    const t = line.trim();
    if (/^direction\s/.test(t) && depth === 1) return [];
    if (/^subgraph\b/.test(t)) return ++depth === 1 ? [line, "    direction TB"] : [line];
    if (t === "end") depth = Math.max(0, depth - 1);
    return [line];
  })].join("\n");
}

async function drawDiagram(stage, code) {
  const mermaid = await loadMermaid();
  // Labels as SVG text, not HTML inside <foreignObject>: the sanitizer below removes foreignObject, which left
  // every box of a flowchart empty.
  // Clean shapes in the app's own font, the size of the text around them, spaced so the boxes don't crowd.
  const font = css("--ui") || "sans-serif";
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", look: "classic", fontFamily: font,
    htmlLabels: false, class: { htmlLabels: false }, state: { htmlLabels: false },
    flowchart: { htmlLabels: false, curve: "basis", padding: 12, nodeSpacing: 34, rankSpacing: 46, wrappingWidth: 170, useMaxWidth: true },
    themeVariables: { primaryColor: css("--ink-tint"), primaryTextColor: css("--heading"), primaryBorderColor: css("--ink"),
      lineColor: css("--graphite"), secondaryColor: css("--raised"), tertiaryColor: css("--sheet"), background: css("--sheet"),
      fontFamily: font, fontSize: "14px", darkMode: dark(), ...branches() } });
  await document.fonts.ready; // labels are measured: the font must be ready first
  const { svg } = await mermaid.render(`diagram-${++diagrams}`, sideBySide(code));
  stage.innerHTML = DOMPurify?.sanitize ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) : svg;
}

async function drawChart(stage, spec) {
  const embed = await loadVega();
  const parsed = typeof spec === "string" ? looseJSON(spec) : spec;
  if (JSON.stringify(parsed).match(/"url"\s*:/)) throw new Error("Charts take their data inline.");
  const ink = css("--ink"), text = css("--graphite"), muted = css("--pencil"), line = css("--line");
  // A chart fits on the screen: a modest height whatever the model asked for, and marks never spill out of the plot
  // (bars under an axis that doesn't start at zero were drawn far below the chart).
  const clip = (s) => {
    if (s.mark) s.mark = typeof s.mark === "string" ? { type: s.mark, clip: true } : { ...s.mark, clip: true };
    (s.layer || []).forEach(clip);
  };
  clip(parsed);
  if (!["facet", "repeat", "concat", "hconcat", "vconcat"].some((k) => k in parsed)) parsed.height = Math.min(Number(parsed.height) || 240, 300);
  await embed(stage, { width: "container", ...parsed, $schema: undefined, background: null }, {
    actions: false, renderer: "svg", tooltip: true,
    config: { background: null, font: css("--ui"), view: { stroke: null }, range: { category: [ink, "#e2a33b", "#c0504d", "#8a6fd1", "#4fa3c7", "#64748b"] },
      axis: { labelColor: muted, titleColor: text, gridColor: line, domainColor: line, tickColor: line, labelFontSize: 12, titleFontSize: 12 },
      legend: { labelColor: text, titleColor: text }, title: { color: text, fontSize: 14 }, mark: { color: ink } },
  });
}

function drawMath(stage, spec) {
  const m = typeof spec === "string" ? looseJSON(spec) : spec;
  stage.innerHTML = `<div class="math-formula">${tex(m.tex || "", true)}</div>
    ${m.terms?.length ? `<dl class="math-terms">${m.terms.map((t) => `<div class="math-term"><dt class="${/^t[1-6]$/.test(t.class) ? t.class : ""}">${tex(t.symbol || "", false)}</dt>
      <dd>${esc(t.meaning || "")}</dd></div>`).join("")}</dl>` : ""}
    ${m.example ? `<p class="math-example">${esc(m.example)}</p>` : ""}`;
}

// A box on a figure: the model names grid cells ("from": "C5", "to": "H11"), read off a chessboard grid drawn over the
// image for it (columns A-T, rows 1-20 since the grid became finer; answers made before say nothing, and used 10 x 10).
// Fractions x, y, w, h (the oldest answers) still work. Returns fractions, or null if it's nonsense.
export function cellOf(name, grid = 10) {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(String(name || "").trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65, row = Number(m[2]) - 1;
  return col >= 0 && col < grid && row >= 0 && row < grid ? [col, row] : null;
}
export function boxArea(b, grid = 10) {
  const a = cellOf(b.from, grid), z = cellOf(b.to || b.from, grid);
  if (a && z) {
    const c0 = Math.min(a[0], z[0]), c1 = Math.max(a[0], z[0]), r0 = Math.min(a[1], z[1]), r1 = Math.max(a[1], z[1]);
    return { x: c0 / grid, y: r0 / grid, w: (c1 - c0 + 1) / grid, h: (r1 - r0 + 1) / grid };
  }
  const n = ["x", "y", "w", "h"].map((k) => Number(b[k]));
  if (n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null;
  const x = Math.min(Math.max(n[0], 0), 1), y = Math.min(Math.max(n[1], 0), 1);
  return { x, y, w: Math.min(n[2], 1 - x), h: Math.min(n[3], 1 - y) };
}

async function drawFigure(stage, spec, ctx) {
  const f = typeof spec === "string" ? looseJSON(spec) : spec;
  const kind = f.table ? "table" : "figure";
  const number = f.table || f.figure;
  const fig = (await ctx.figures?.())?.find((x) => x.kind === kind && x.number === Number(number));
  if (!fig) { stage.innerHTML = `<p class="faint">${kind === "table" ? "Table" : "Figure"} ${esc(String(number))} isn't available (the PDF's figures are cut out from their captions).</p>`; return; }
  const boxes = (Array.isArray(f.boxes) ? f.boxes : []).map((b) => ({ ...boxArea(b || {}, f.grid || 10), label: b?.label })).filter((b) => b.w).slice(0, 6);
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const name = `${kind === "table" ? "Table" : "Figure"} ${number}`;
  const asking = !!ctx.askAbout;
  stage.innerHTML = `<div class="figure-frame"><img src="${fig.url}" alt="${esc(fig.caption)}">
      ${boxes.map((b, i) => `<span class="figure-box" data-box="${i}" style="left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}"
        ${asking ? `role="button" tabindex="0" title="Ask about ${esc(b.label || `part ${i + 1}`)}"` : ""}>
        <span class="figure-box-label">${i + 1}</span></span>`).join("")}</div>
    ${boxes.length > 1 ? `<div class="figure-tour" role="group" aria-label="One part at a time">
      <button type="button" class="link-button" data-tour="-1" aria-label="Previous part">‹</button>
      <span class="figure-tour-at" aria-live="polite">Go through the ${boxes.length} parts</span>
      <button type="button" class="link-button" data-tour="1" aria-label="Next part">›</button></div>` : ""}
    <figcaption>${boxes.map((b, i) => `<span class="figure-box-note" data-box="${i}"><b>${i + 1}</b> ${esc(b.label || "")}</span>`).join("")}
      <span class="faint">${esc(fig.caption)} · page ${fig.page}${boxes.length && asking ? " · click a box to ask about it" : ""}</span></figcaption>`;
  // One box stands out: the one pointed at, or the tour's current one. Its note stands out with it.
  let touring = null;
  const show = (at) => {
    stage.querySelectorAll("[data-box]").forEach((el) => el.classList.toggle("is-lit", at != null && el.dataset.box === String(at)));
    stage.classList.toggle("has-lit", at != null);
  };
  const lit = (e) => show(e.type === "mouseover" ? e.target.closest?.("[data-box]")?.dataset.box ?? touring : touring);
  stage.onmouseover = lit;
  stage.onmouseout = lit;
  stage.onclick = (e) => {
    const step = e.target.closest("[data-tour]");
    if (step) {
      touring = ((touring ?? (step.dataset.tour === "1" ? -1 : boxes.length)) + Number(step.dataset.tour) + boxes.length) % boxes.length;
      stage.querySelector(".figure-tour-at").textContent = `${touring + 1} of ${boxes.length}: ${boxes[touring].label || "this part"}`;
      return show(touring);
    }
    const box = e.target.closest(".figure-box");
    if (box && asking) {
      const b = boxes[box.dataset.box];
      ctx.askAbout(`In ${name}, the part in box ${Number(box.dataset.box) + 1} (${b.label || "this part"}): `);
    }
  };
  stage.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest(".figure-box")) { e.preventDefault(); e.target.click(); } };
}

// A page the model wrote (```page, only when Settings allows it): run in a sealed frame. The frame can't reach the
// app, your files or the network (no same-origin, a Content-Security-Policy with no connections); scripts may load
// only from the jsdelivr CDN. Otherwise the code is shown, not run.
const PAGE_POLICY = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; "
  + "img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

function drawPage(stage, html, ctx) {
  if (!ctx.allowPages) {
    stage.innerHTML = `<details class="visual-failed"><summary>An interactive page the AI wrote. Turn on "Interactive pages" in
      Settings to run it (in a sealed frame).</summary><pre>${esc(html.slice(0, 4000))}</pre></details>`;
    return;
  }
  const theme = `<style>:root{color-scheme:${dark() ? "dark" : "light"};--ink:${css("--ink")};--text:${css("--graphite")};--muted:${css("--pencil")};
    --line:${css("--line")};--bg:${css("--sheet")}}body{margin:0;padding:12px;font:15px/1.5 system-ui,sans-serif;color:var(--text);background:var(--bg)}</style>`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">${theme}</head>
    <body>${html}<script>{const s=()=>parent.postMessage({paperPageHeight:document.documentElement.scrollHeight},"*");
      addEventListener("load",s);new ResizeObserver(s).observe(document.body)}<\/script></body></html>`;
  const frame = document.createElement("iframe");
  frame.className = "visual-page";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = "Interactive page";
  frame.srcdoc = doc;
  stage.innerHTML = "";
  stage.append(frame);
  const resize = (e) => {
    if (e.source === frame.contentWindow && Number.isFinite(e.data?.paperPageHeight)) {
      frame.style.height = `${Math.min(Math.max(e.data.paperPageHeight, 120), 900)}px`;
    }
  };
  addEventListener("message", resize);
}

// Two figures side by side (```compare, made with the compare_with_figure tool and checked on the server): the parts
// that do the same job share a colour; parts with no counterpart are grey and dashed. Pointing at a pair lights both.
const PAIR = ["#3d5fd6", "#e07a2e", "#8a5cd6", "#d14b6a", "#9a6b3c", "#c9a227"]; // no green: it means "done" elsewhere

async function drawCompare(stage, spec, ctx) {
  const c = typeof spec === "string" ? looseJSON(spec) : spec;
  const figuresOf = async (paper) => paper ? (await fetch(`/api/papers/${Number(paper)}/figures`)).json() : (await ctx.figures?.()) || [];
  const [mine, theirs] = await Promise.all([figuresOf(null), figuresOf(c.right?.paper)]);
  const find = (list, n) => list.find((f) => f.kind === "figure" && f.number === Number(n));
  const sides = [{ ...c.left, fig: find(mine, c.left?.figure) }, { ...c.right, fig: find(theirs, c.right?.figure) }];
  if (sides.some((s) => !s.fig)) throw new Error("One of the two figures isn't available.");
  const colour = [{}, {}];
  (c.pairs || []).forEach((p, i) => { colour[0][p.left - 1] = i; colour[1][p.right - 1] = i; });
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const side = (s, k) => {
    const boxes = (s.boxes || []).map((b) => ({ ...boxArea(b || {}, c.grid || 10), label: b?.label })).filter((b) => b.w);
    return `<figure class="cmp-side">
      <div class="cmp-frame"><img src="${s.fig.url}" alt="${esc(s.fig.caption)}">
        ${boxes.map((b, j) => { const i = colour[k][j];
          return `<span class="cmp-box${i == null ? " is-alone" : ""}" ${i == null ? "" : `data-pair="${i}"`}
            style="${i == null ? "" : `--pair:${PAIR[i % PAIR.length]};`}left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}"
            title="${esc(b.label || "")}"></span>`; }).join("")}</div>
      <figcaption>${k ? "Other paper" : "This paper"} · Figure ${s.fig.number}, page ${s.fig.page}</figcaption></figure>`;
  };
  const label = (k, n) => (sides[k].boxes || [])[n - 1]?.label || "";
  stage.innerHTML = `<div class="cmp-sides">${sides.map(side).join("")}</div>
    ${(c.pairs || []).length ? `<ul class="cmp-pairs">${c.pairs.map((p, i) => `<li data-pair="${i}" style="--pair:${PAIR[i % PAIR.length]}">
      <i aria-hidden="true"></i><strong>${esc(p.same || "The same part")}</strong>
      <span class="faint">${esc(label(0, p.left))} ↔ ${esc(label(1, p.right))}</span></li>`).join("")}</ul>`
      : `<p class="faint">No parts were matched with confidence.</p>`}`;
  const light = (i) => {
    stage.querySelectorAll("[data-pair]").forEach((el) => el.classList.toggle("is-lit", i != null && el.dataset.pair === i));
    stage.classList.toggle("has-lit", i != null);
  };
  stage.onmouseover = (e) => light(e.target.closest("[data-pair]")?.dataset.pair ?? null);
  stage.onmouseout = () => light(null);
}

const DRAW = { diagram: drawDiagram, chart: drawChart, math: drawMath, figure: drawFigure, compare: drawCompare };

export async function drawVisuals(root, ctx = {}) {
  root.querySelectorAll(".cite").forEach((b) => { b.onclick = () => ctx.onCite?.(b.dataset.cite, b.dataset.ref, ctx); });
  for (const el of root.querySelectorAll("figure.visual[data-visual]:not([data-drawn])")) {
    el.dataset.drawn = "1";
    el.querySelector(".visual-open").onclick = () => ctx.onOpen?.(el.dataset.visual, el.dataset.spec);
    await drawOne(el.querySelector(".visual-stage"), el.dataset.visual, el.dataset.spec, ctx);
  }
}

export async function drawOne(stage, kind, spec, ctx = {}) {
  stage.innerHTML = `<p class="faint visual-loading">Drawing…</p>`;
  try {
    if (kind === "widget") {
      const { drawWidget } = await import("./widgets.js");
      await drawWidget(stage, looseJSON(spec), { ...ctx, render: renderAnswer });
    } else if (kind === "page") drawPage(stage, spec, ctx);
    else await DRAW[kind](stage, spec, ctx);
  } catch (e) {
    stage.innerHTML = `<details class="visual-failed"><summary>This ${KIND[kind]?.toLowerCase() || "visual"} couldn't be drawn.</summary>
      <p class="faint">${esc(e.message || String(e))}</p><pre>${esc(String(spec).slice(0, 2000))}</pre></details>`;
  }
}
