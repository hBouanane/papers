// Marks the paper's hard words in the page (both views): each match is wrapped in <abbr class="term"
// data-term="…">, once per section of the Text view and once per page of the PDF, so the page doesn't fill
// with underlines. Works on what's already on the page, so it can run again at any time: words already
// marked are kept, words you now know are unmarked (unmarkWords), new words are marked.
//
// In the PDF the words live in PDF.js's text layer, whose <span>s are absolutely positioned; marks are <abbr>,
// which it leaves alone. Highlights are stored as page rectangles, so wrapping text doesn't move them.

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Where a new "once per section" scope starts while walking the Text view.
const SECTION_START = "h2, h3";
// Text that never gets marks: headings, equations, the reference list, the end-of-paper box.
const SKIP = "h1, h2, h3, .math, .refs-list, .article-end, abbr.term";

function pattern(words) {
  const terms = words.map((w) => w.term.trim()).filter(Boolean).sort((a, b) => b.length - a.length).map(reEscape);
  return terms.length ? new RegExp(`(?<![\\w-])(${terms.join("|")})(?![\\w-])`, "gi") : null;
}

// Wrap the first match of each word not in `seen` within these text nodes.
function markScope(nodes, re, seen) {
  for (const node of nodes) {
    const hits = [];
    for (const m of node.data.matchAll(re)) {
      const key = m[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push([m.index, m[0].length, key]);
    }
    for (const [at, length, key] of hits.reverse()) { // from the end, so earlier offsets stay right
      const word = node.splitText(at);
      word.splitText(length);
      const abbr = document.createElement("abbr");
      abbr.className = "term";
      abbr.dataset.term = key;
      word.replaceWith(abbr);
      abbr.append(word);
    }
  }
}

const textNodes = (root) => {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(SKIP) || !n.data.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
};

// Remove the marks under `root` for words that aren't in `keep` (a set of lowercase terms).
export function unmarkWords(root, keep = new Set()) {
  root.querySelectorAll("abbr.term").forEach((a) => {
    if (keep.has(a.dataset.term)) return;
    const parent = a.parentNode;
    a.replaceWith(...a.childNodes);
    parent.normalize();
  });
}

// The Text view (`article`): once per section.
export function markText(article, words) {
  const re = pattern(words);
  if (!re) return;
  const scopes = [{ nodes: [], seen: new Set() }];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const scope = scopes[scopes.length - 1];
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (n.matches(SECTION_START)) scopes.push({ nodes: [], seen: new Set() });
      else if (n.matches("abbr.term")) scope.seen.add(n.dataset.term); // already marked in this section
    } else if (n.data.trim() && !n.parentElement.closest(SKIP)) scope.nodes.push(n);
  }
  scopes.forEach(({ nodes, seen }) => markScope(nodes, re, seen));
}

// One PDF page's text layer: once per page.
export function markPdfPage(textLayer, words) {
  const re = pattern(words);
  if (!re || !textLayer) return;
  const seen = new Set([...textLayer.querySelectorAll("abbr.term")].map((a) => a.dataset.term));
  markScope(textNodes(textLayer), re, seen);
}
