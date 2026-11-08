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

// Lays out every page at its final size up front (so scroll positions are stable), then draws
// pages as they come near the viewport. Zooming redraws pages at the new size instead of
// stretching the old image, so text stays sharp; so does a change of screen pixel density
// (browser zoom, moving the window to another monitor).
// Returns { close, pages: [element], outline: [{ title, depth, el, at }], zoom, setZoom(z) }.
export async function renderPdf(url, container, { zoom = 1 } = {}) {
  const lib = await load();
  const doc = await lib.getDocument(url).promise;
  const fitWidth = container.clientWidth;
  const pages = [];
  container.innerHTML = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const el = document.createElement("div");
    el.className = "pdf-page";
    container.append(el);
    pages.push({ page, el, base: page.getViewport({ scale: 1 }).width, drawn: false, task: null });
  }

  const layout = () => {
    pages.forEach((p) => {
      p.task?.cancel();
      p.viewport = p.page.getViewport({ scale: (fitWidth / p.base) * zoom });
      p.el.style.width = `${p.viewport.width}px`;
      p.el.style.height = `${p.viewport.height}px`;
      p.el.style.setProperty("--scale-factor", p.viewport.scale);
      p.el.innerHTML = "";
      p.drawn = false;
    });
    // Re-observing makes the observer report which pages are visible now.
    pages.forEach((p) => { observer.unobserve(p.el); observer.observe(p.el); });
  };

  const draw = async (p) => {
    if (p.drawn) return;
    p.drawn = true;
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(p.viewport.width * ratio);
    canvas.height = Math.floor(p.viewport.height * ratio);
    p.el.append(canvas);
    p.task = p.page.render({
      canvasContext: canvas.getContext("2d"),
      viewport: p.viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    });
    try { await p.task.promise; } catch { return; } // cancelled by a newer zoom
    const text = document.createElement("div");
    text.className = "textLayer";
    p.el.append(text);
    await new lib.TextLayer({ textContentSource: p.page.streamTextContent(), container: text, viewport: p.viewport }).render();
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting && draw(pages.find((p) => p.el === e.target)));
  }, { rootMargin: "1200px 0px" });
  layout();

  // Redraw sharply when the screen's pixel density changes.
  let density;
  const watchDensity = () => {
    density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener("change", onDensity, { once: true });
  };
  const onDensity = () => { layout(); watchDensity(); };
  watchDensity();

  return {
    close() { observer.disconnect(); density.removeEventListener("change", onDensity); doc.destroy(); },
    pages: pages.map((p) => p.el),
    outline: await outline(doc, pages),
    get zoom() { return zoom; },
    setZoom(next) {
      zoom = Math.min(3, Math.max(0.5, Math.round(next * 100) / 100));
      layout();
      return zoom;
    },
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
          // Where on the page the section starts, as a fraction of its height (zoom-independent).
          const y = dest[1]?.name === "XYZ" && dest[3] != null ? p.viewport.convertToViewportPoint(0, dest[3])[1] : 0;
          found.push({ title: item.title, depth, el: p.el, at: Math.max(0, y) / p.viewport.height });
        }
      } catch { /* broken outline entry: skip it */ }
      if (depth < 1) await walk(item.items, depth + 1);
    }
  };
  await walk(await doc.getOutline(), 0);
  return found;
}
