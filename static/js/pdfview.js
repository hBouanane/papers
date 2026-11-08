// Renders a PDF with PDF.js: a canvas per page plus a text layer so passages can be selected.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168";
let pdfjs;

async function load() {
  if (!pdfjs) {
    pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

// Lays out every page at its final size up front (so scroll positions are stable),
// then draws pages as they come near the viewport.
// Returns { close, pages: [element], outline: [{ title, depth, el, offset }] }.
export async function renderPdf(url, container) {
  const lib = await load();
  const doc = await lib.getDocument(url).promise;
  const width = container.clientWidth;
  const pages = [];
  container.innerHTML = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const el = document.createElement("div");
    el.className = "pdf-page";
    el.style.width = `${viewport.width}px`;
    el.style.height = `${viewport.height}px`;
    el.style.setProperty("--scale-factor", viewport.scale);
    container.append(el);
    pages.push({ page, viewport, el, drawn: false });
  }

  const draw = async (p) => {
    if (p.drawn) return;
    p.drawn = true;
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(p.viewport.width * ratio);
    canvas.height = Math.floor(p.viewport.height * ratio);
    p.el.append(canvas);
    await p.page.render({
      canvasContext: canvas.getContext("2d"),
      viewport: p.viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    const text = document.createElement("div");
    text.className = "textLayer";
    p.el.append(text);
    await new lib.TextLayer({ textContentSource: p.page.streamTextContent(), container: text, viewport: p.viewport }).render();
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting && draw(pages.find((p) => p.el === e.target)));
  }, { rootMargin: "1200px 0px" });
  pages.forEach((p) => observer.observe(p.el));

  return {
    close() { observer.disconnect(); doc.destroy(); },
    pages: pages.map((p) => p.el),
    outline: await outline(doc, pages),
  };
}

// The PDF's own table of contents (two levels), resolved to page elements and offsets.
async function outline(doc, pages) {
  const found = [];
  const walk = async (items, depth) => {
    for (const item of items || []) {
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        if (dest) {
          const index = typeof dest[0] === "number" ? dest[0] : await doc.getPageIndex(dest[0]);
          const p = pages[index];
          const offset = dest[1]?.name === "XYZ" && dest[3] != null ? p.viewport.convertToViewportPoint(0, dest[3])[1] : 0;
          found.push({ title: item.title, depth, el: p.el, offset: Math.max(0, offset) });
        }
      } catch { /* broken outline entry: skip it */ }
      if (depth < 1) await walk(item.items, depth + 1);
    }
  };
  await walk(await doc.getOutline(), 0);
  return found;
}
