// Drawing highlights on the paper, in both views.
// - In the PDF a highlight is stored as rectangles on its page (fractions of the page size), so it stays
//   in place at any zoom. They are drawn under the text layer, so text stays selectable.
// - In the Text view it is found by its quoted text (ignoring spaces and line breaks), taking the
//   occurrence nearest to where it was made; that also shows highlights made in the PDF.

const squash = (s) => s.replace(/-\s+/g, "").replace(/\s+/g, "");

// ---------- PDF ----------
// Where a selection is on the PDF pages: { rects: [[page, x, y, w, h], …] } or null.
export function pdfAnchor(range, container) {
  const pages = [...container.querySelectorAll(".page[data-page-number]")].map((el) => ({ el, box: el.getBoundingClientRect() }));
  const rects = [];
  for (const r of lineBoxes(range)) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const page = pages.find(({ box }) => cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom);
    if (!page) continue;
    const { box } = page;
    const rect = [Number(page.el.dataset.pageNumber), (r.left - box.left) / box.width, (r.top - box.top) / box.height,
      r.width / box.width, r.height / box.height].map((v, i) => (i ? Math.round(v * 10000) / 10000 : v));
    rects.push(rect);
  }
  return rects.length ? { rects } : null;
}

// One box per line of selected text: only the text itself (not the boxes of the elements around it),
// with pieces on the same line joined, so overlapping parts don't look darker.
function lineBoxes(range) {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!range.intersectsNode(node) || !node.data.trim()) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    for (const r of part.getClientRects()) if (r.width >= 1 && r.height >= 1) pieces.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  pieces.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const r of pieces) {
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - (r.top + r.bottom) / 2) < (r.bottom - r.top) / 2
      && r.left <= l.right + 12 && r.right >= l.left - 12);
    if (line) Object.assign(line, { left: Math.min(line.left, r.left), right: Math.max(line.right, r.right),
      top: Math.min(line.top, r.top), bottom: Math.max(line.bottom, r.bottom) });
    else lines.push({ ...r });
  }
  return lines.map((l) => ({ left: l.left, top: l.top, width: l.right - l.left, height: l.bottom - l.top }));
}

// Draw the highlights that fall on one rendered page (called again whenever the page is redrawn).
export function drawPdfPage(div, pageNumber, items) {
  div.querySelector(".hl-layer:not(.hl-quotes)")?.remove();
  const marks = items.filter((n) => n.kind === "highlight" && n.anchor?.rects)
    .flatMap((n) => n.anchor.rects.filter((r) => r[0] === pageNumber).map((r) => ({ n, r })));
  if (!marks.length) return;
  const layer = document.createElement("div");
  layer.className = "hl-layer";
  layer.innerHTML = marks.map(({ n, r: [, x, y, w, h] }) =>
    `<span class="hl hl-${n.color}" data-note="${n.id}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"></span>`).join("");
  div.insertBefore(layer, div.querySelector(".textLayer"));
}

export function drawPdf(container, items) {
  container.querySelectorAll(".page[data-page-number]").forEach((div) => {
    if (div.querySelector("canvas")) drawPdfPage(div, Number(div.dataset.pageNumber), items);
    const text = div.querySelector(".textLayer");
    if (text?.childElementCount) drawPdfQuotes(text, items);
  });
}

// Highlights kept only as their quoted text (the AI's, made in Deep mode): found in a page's text once it's drawn,
// and marked the same way as yours.
export function drawPdfQuotes(textLayer, items) {
  const div = textLayer?.closest(".page");
  if (!div) return;
  div.querySelector(".hl-quotes")?.remove();
  const quoted = items.filter((n) => n.kind === "highlight" && !n.anchor?.rects && squash(n.quote || "").length >= 3);
  if (!quoted.length) return;
  const { text, map } = textIndex(textLayer);
  const box = div.getBoundingClientRect();
  const marks = [];
  for (const n of quoted) {
    const at = text.indexOf(squash(n.quote));
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(...map[at]);
    const [endNode, endOffset] = map[at + squash(n.quote).length - 1];
    range.setEnd(endNode, endOffset + 1);
    for (const r of lineBoxes(range)) {
      marks.push(`<span class="hl hl-${n.color}" data-note="${n.id}" style="left:${(r.left - box.left) / box.width * 100}%;`
        + `top:${(r.top - box.top) / box.height * 100}%;width:${r.width / box.width * 100}%;height:${r.height / box.height * 100}%"></span>`);
    }
  }
  if (!marks.length) return;
  const layer = document.createElement("div");
  layer.className = "hl-layer hl-quotes";
  layer.innerHTML = marks.join("");
  div.insertBefore(layer, textLayer);
}

// ---------- Text view ----------
// Every non-space character of the article with its text node and offset.
function textIndex(root) {
  const chars = [];
  const map = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement.closest(".article-end") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      if (!/\s/.test(data[i])) { chars.push(data[i]); map.push([node, i]); }
    }
  }
  return { text: chars.join(""), map };
}

// Where a Text view selection starts, counted in non-space characters (to tell repeated phrases apart).
export function textAnchor(article, range) {
  const before = document.createRange();
  before.selectNodeContents(article);
  before.setEnd(range.startContainer, range.startOffset);
  return { at: squash(before.toString()).length };
}

// Wrap each text node inside the range in its own <mark> (a range may cross paragraphs and links).
function wrap(range, make) {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
  for (let node of nodes) {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start || !node.data.slice(start, end).trim()) continue;
    if (end < node.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);
    const mark = make();
    node.parentNode.insertBefore(mark, node);
    mark.appendChild(node);
  }
}

export function drawText(article, items) {
  if (!article) return;
  article.querySelectorAll("mark.hl").forEach((m) => m.replaceWith(...m.childNodes));
  article.normalize();
  const highlights = items.filter((n) => n.kind === "highlight");
  if (!highlights.length) return;
  const { text, map } = textIndex(article);
  // Find them all first: Ranges stay correct while the text nodes are split for the marks.
  const found = [];
  for (const n of highlights) {
    const q = squash(n.quote);
    if (q.length < 2) continue;
    const target = n.anchor?.at ?? n.position * text.length;
    let best = -1;
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
      if (best < 0 || Math.abs(i - target) < Math.abs(best - target)) best = i;
    }
    if (best < 0) continue;
    const [startNode, startOffset] = map[best];
    const [endNode, endOffset] = map[best + q.length - 1];
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset + 1);
    found.push({ n, range });
  }
  for (const { n, range } of found) {
    wrap(range, () => {
      const mark = document.createElement("mark");
      mark.className = `hl hl-${n.color}`;
      mark.dataset.note = n.id;
      return mark;
    });
  }
}
