// Drawing an answer: Markdown (tables, code, lists), math typeset with KaTeX, citations you can click ([§3.4],
// [Fig. 1], [Table 2], [p. 5]) and visuals the model describes in fenced blocks:
//   ```chart    a Vega-Lite spec (bar, line, scatter, heatmap) with its data inline
//   ```diagram  a Mermaid diagram (flowchart, sequence, ...)
//   ```math     {"tex": ..., "terms": [{"class": "t1", "symbol": ..., "meaning": ...}]}: a formula with its parts coloured and explained
//   ```figure   {"figure": 1} or {"table": 2}, with optional "boxes" [{x, y, w, h, label}] (fractions of the image)
//   ```widget   an interactive visual (widgets.js)
// No code from the model runs: specs are data, drawn by these libraries. HTML is sanitised (DOMPurify).
//
//   renderAnswer(text, { streaming })  → HTML (visuals as placeholders)
//   drawVisuals(root, ctx)             → draws the placeholders in root (lazy-loads Mermaid and Vega once needed)
import { esc } from "../core.js";
import { iconButton } from "../icons.js";

const CDN = "https://cdn.jsdelivr.net/npm";
const [{ Marked }, { default: DOMPurify }, { default: katex }] = await Promise.all([
  import(`${CDN}/marked@12.0.2/lib/marked.esm.js`),
  import(`${CDN}/dompurify@3.1.6/dist/purify.es.mjs`),
  import(`${CDN}/katex@0.16.11/dist/katex.mjs`),
]).catch(() => [{}, {}, {}]); // offline: plain text rendering below still works
if (katex && !document.querySelector("link[data-katex]")) {
  document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" data-katex href="${CDN}/katex@0.16.11/dist/katex.min.css">`);
}
const marked = Marked ? new Marked({ gfm: true, breaks: false }) : null;

export const VISUALS = ["chart", "diagram", "math", "figure", "widget", "page"];
const FENCE = new RegExp("```(" + VISUALS.join("|") + "|followups)[^\\n]*\\n([\\s\\S]*?)(```|$)", "g");
const KIND = { chart: "Chart", diagram: "Diagram", math: "Formula", figure: "Figure", widget: "Interactive", page: "Interactive page" };

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

const loadMermaid = () => (mermaidReady ??= import(`${CDN}/mermaid@10.9.1/dist/mermaid.esm.min.mjs`).then(({ default: m }) => m));
const loadVega = () => (vegaReady ??= import(`${CDN}/vega-embed@6.26.0/+esm`).then((m) => m.default));
let diagrams = 0;

async function drawDiagram(stage, code) {
  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: css("--ui") || "sans-serif",
    themeVariables: { primaryColor: css("--ink-tint"), primaryTextColor: css("--graphite"), primaryBorderColor: css("--ink"),
      lineColor: css("--pencil"), secondaryColor: css("--raised"), tertiaryColor: css("--sheet"), background: css("--sheet"),
      fontSize: "14px", darkMode: dark() } });
  const { svg } = await mermaid.render(`diagram-${++diagrams}`, code);
  stage.innerHTML = DOMPurify?.sanitize ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) : svg;
}

async function drawChart(stage, spec) {
  const embed = await loadVega();
  const parsed = typeof spec === "string" ? looseJSON(spec) : spec;
  if (JSON.stringify(parsed).match(/"url"\s*:/)) throw new Error("Charts take their data inline.");
  const ink = css("--ink"), text = css("--graphite"), muted = css("--pencil"), line = css("--line");
  await embed(stage, { width: "container", ...parsed, $schema: undefined, background: null }, {
    actions: false, renderer: "svg", tooltip: true,
    config: { background: null, font: css("--ui"), view: { stroke: null }, range: { category: [ink, "#e2a33b", "#3a9a6e", "#c0504d", "#8a6fd1", "#4fa3c7"] },
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

// A box on a figure: the model names grid cells ("from": "B3", "to": "E5": columns A–J, rows 1–10, the grid it was
// shown over the image); fractions x, y, w, h (older answers) still work. Returns fractions, or null if it's nonsense.
const CELL = /^([A-Ja-j])(10|[1-9])$/;
export function boxArea(b) {
  const a = CELL.exec(String(b.from || "").trim()), z = CELL.exec(String(b.to || b.from || "").trim());
  if (a && z) {
    const col = (m) => m[1].toUpperCase().charCodeAt(0) - 65, row = (m) => Number(m[2]) - 1;
    const c0 = Math.min(col(a), col(z)), c1 = Math.max(col(a), col(z)), r0 = Math.min(row(a), row(z)), r1 = Math.max(row(a), row(z));
    return { x: c0 / 10, y: r0 / 10, w: (c1 - c0 + 1) / 10, h: (r1 - r0 + 1) / 10 };
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
  const boxes = (Array.isArray(f.boxes) ? f.boxes : []).map((b) => ({ ...boxArea(b || {}), label: b?.label })).filter((b) => b.w);
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  stage.innerHTML = `<div class="figure-frame"><img src="${fig.url}" alt="${esc(fig.caption)}">
      ${boxes.map((b, i) => `<span class="figure-box" data-box="${i}" style="left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}">
        <span class="figure-box-label">${i + 1}</span></span>`).join("")}</div>
    <figcaption>${boxes.map((b, i) => `<span class="figure-box-note" data-box="${i}"><b>${i + 1}</b> ${esc(b.label || "")}</span>`).join("")}
      <span class="faint">${esc(fig.caption)} · page ${fig.page}</span></figcaption>`;
  // Point at a note and its box stands out (and the other way round)
  const lit = (e) => {
    const at = e.type === "mouseover" ? e.target.closest?.("[data-box]")?.dataset.box : null;
    stage.querySelectorAll("[data-box]").forEach((el) => el.classList.toggle("is-lit", at != null && el.dataset.box === at));
    stage.classList.toggle("has-lit", at != null);
  };
  stage.onmouseover = lit;
  stage.onmouseout = lit;
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

const DRAW = { diagram: drawDiagram, chart: drawChart, math: drawMath, figure: drawFigure };

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
