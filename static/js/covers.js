// Paper covers: the first page of the paper's PDF, drawn small, like a book on a shelf.
// Papers without a PDF get a typeset cover instead (title in the paper serif, authors, year), which
// also shows while the real page is being drawn. Pages are drawn only when a cover scrolls into view,
// one at a time, and kept in the browser's cache so the next visit shows them at once.
import { cite, esc } from "./core.js";

const RENDER_WIDTH = 240; // CSS px; the largest cover is about this wide
const drawn = new Map(); // paper id -> Promise of an image URL (or null when the PDF can't be drawn)
const CACHE = "paper-covers-v1";
const key = (id) => `/covers/${id}.png`;
let queue = Promise.resolve();

// The browser's Cache Storage survives reloads; it may be missing (or refuse) in private windows.
async function cached(id) {
  try { return await (await caches.open(CACHE)).match(key(id)).then((r) => r?.blob()); } catch { return null; }
}
async function keep(id, blob) {
  try { await (await caches.open(CACHE)).put(key(id), new Response(blob, { headers: { "content-type": "image/png" } })); } catch { /* fine */ }
}

// `size` is "large" (the paper you're reading, a paper's own page) or "small" (a row of covers).
// Every cover has a second sheet tilted behind it; inside a link, hovering lifts the page and fans the sheet.
export function cover(p, size = "small") {
  return `<span class="cover-wrap"><span class="cover-sheet" aria-hidden="true"></span>
    <span class="cover cover-${size}" data-cover="${p.id}" ${p.has_pdf ? "data-pdf" : ""}>
    <span class="cover-type" aria-hidden="true">
      <span class="cover-title">${esc(p.title)}</span>
      ${p.authors || p.year ? `<span class="cover-rule"></span><span class="cover-cite">${cite(p)}</span>` : ""}
    </span></span></span>`;
}

function thumbnail(id) {
  if (!drawn.has(id)) {
    const job = cached(id).then((blob) => blob || (queue = queue.then(async () => {
      const { renderThumbnail } = await import("./pdfview.js");
      const canvas = await renderThumbnail(`/api/papers/${id}/file`, document.createElement("canvas"), RENDER_WIDTH);
      const drawnBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (drawnBlob) await keep(id, drawnBlob);
      return drawnBlob;
    }).catch(() => null))) // a broken PDF keeps its typeset cover
      .then((blob) => (blob ? URL.createObjectURL(blob) : null));
    drawn.set(id, job);
  }
  return drawn.get(id);
}

async function fill(el) {
  const src = await thumbnail(el.dataset.cover);
  if (!src || !el.isConnected || el.querySelector("img")) return;
  const img = new Image();
  img.alt = "";
  img.onload = () => {
    el.classList.add("has-page");
    const sheet = el.parentElement?.querySelector(".cover-sheet");
    if (sheet) { sheet.style.setProperty("--sheet-page", `url("${src}")`); sheet.classList.add("has-page"); }
  };
  img.src = src;
  el.append(img);
}

// Draws the covers inside `root` as they come near the screen.
export function drawCovers(root) {
  const covers = [...root.querySelectorAll(".cover[data-pdf]")];
  if (!covers.length) return;
  if (!("IntersectionObserver" in window)) return covers.forEach(fill);
  const seen = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    seen.unobserve(e.target);
    fill(e.target);
  }), { rootMargin: "200px" });
  covers.forEach((el) => seen.observe(el));
}

// After a new PDF is uploaded the old drawing is stale.
export function forgetCover(id) {
  drawn.delete(String(id));
  globalThis.caches?.open(CACHE).then((c) => c.delete(key(id))).catch(() => {});
}
