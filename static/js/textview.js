// Turns a paper's extracted text into a readable page: front matter, a highlighted abstract,
// real section headings, figure and table captions, display equations and a compact reference list.
import { esc } from "./core.js";

const HEADING = /^(\d+(\.\d+)*\.?\s+[A-Z]\S.{0,70}|abstract|introduction|related work|background|method(s|ology)?|experiments?|results|discussion|conclusions?|references|bibliography|acknowledg\w*|appendix\b.{0,60})$/i;
const CAPTION = /^(figure|fig\.|table)\s*\d+\s*[:.]/i;
const isReferences = (t) => /^(\d+\s+)?(references|bibliography)$/i.test(t);
// Lines that are mostly symbols with an equals sign are display equations.
const looksLikeMath = (t) => t.length < 160 && /[=≤≥∑∏√]/.test(t) && (t.match(/[A-Za-z]{4,}/g) || []).length < 6;

export function renderPaperText(p, markTerms = (html) => html) {
  const lines = p.text.split("\n").map((t) => t.trim()).filter(Boolean);
  const abstractAt = lines.slice(0, 80).findIndex((t) => /^abstract\b/i.test(t));
  const out = [];
  const headings = [];
  let inAbstract = false;
  let inRefs = false;
  let seen = new Set(); // hard words already underlined in the current section
  const mark = (html) => markTerms(html, seen);

  out.push(`<header class="paper-front"><h1 class="paper-name">${esc(p.title)}</h1>
    ${p.authors || p.year ? `<p class="article-cite">${esc(p.authors)}${p.year ? ` (${p.year})` : ""}</p>` : ""}</header>`);

  lines.forEach((t, i) => {
    // Title, authors and affiliations as extracted from the PDF: we already show them above.
    if (abstractAt > 0 && i < abstractAt) return;
    const inline = /^abstract\b\S*\s+(.{40,})$/i.exec(t); // "Abstract We present..." on one line
    if (inline || (HEADING.test(t) && t.length < 80)) {
      const title = inline ? "Abstract" : t;
      if (inAbstract) out.push("</section>");
      if (inRefs) out.push("</ol>");
      inAbstract = /^abstract$/i.test(title);
      inRefs = isReferences(title);
      seen = new Set();
      const id = `sec-${headings.length}`;
      const level = /^\d+\.\d+/.test(title) ? 3 : 2;
      headings.push({ id, label: title, level });
      if (inAbstract) out.push(`<section class="abstract-box"><h2 id="${id}">Abstract</h2>`);
      else out.push(`<h${level} id="${id}" class="section-head">${esc(title)}</h${level}>`);
      if (inline) out.push(`<p>${mark(esc(inline[1]))}</p>`);
      if (inRefs) out.push(`<ol class="refs-list">`);
      return;
    }
    if (inRefs) return out.push(`<li>${esc(t)}</li>`);
    if (CAPTION.test(t)) return out.push(`<p class="caption">${mark(esc(t))}</p>`);
    if (looksLikeMath(t)) return out.push(`<p class="math">${esc(t)}</p>`);
    out.push(`<p${t.length < 60 ? ' class="short"' : ""}>${mark(esc(t))}</p>`);
  });
  if (inAbstract) out.push("</section>");
  if (inRefs) out.push("</ol>");
  return { html: `<div class="article-body">${out.join("")}</div>`, headings };
}
