// The original PDF, shown with PDF.js's own viewer component (the one Firefox uses).
// It draws only the pages near the screen, keeps a selectable text layer, follows links inside the
// PDF (like citations), and zooms smoothly: pages are stretched at once and redrawn sharp shortly
// after, around the point you zoom at.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168";
const MAX_WIDTH = 920; // px: wider pages are hard to read line by line
const CSS_PER_PDF_UNIT = 96 / 72; // PDF.js scale 1 shows a page at 96 dpi
let libs;
let core;

// Just the PDF library (enough to draw a page), without the viewer component.
function loadCore() {
  core ??= import(`${PDFJS}/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
    globalThis.pdfjsLib = pdfjs; // the viewer module reads the library from here
    return pdfjs;
  });
  return core;
}

async function load() {
  if (!libs) {
    const pdfjs = await loadCore();
    libs = { pdfjs, viewer: await import(`${PDFJS}/pdf_viewer.mjs`) };
  }
  return libs;
}

// Draws the first page of a PDF into `canvas`, `width` CSS pixels wide (sharp on high-density screens).
// Used for the paper covers in the Library and on a paper's page.
export async function renderThumbnail(url, canvas, width) {
  const pdfjs = await loadCore();
  // Range requests only: fetch the parts page 1 needs, not the whole file.
  const doc = await pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width * Math.min(devicePixelRatio || 1, 2)) / base.width });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  } finally {
    doc.destroy();
  }
  return canvas;
}

// `container` must be absolutely positioned and scrollable; the viewer scrolls inside it.
// `after` is HTML placed below the last page (e.g. an end-of-paper box).
// `dark` recolours the page background and its text and lines, but leaves images alone
// (PDF.js's high-contrast mode, which Firefox uses), unlike inverting the whole page.
// In dim and dark mode the page takes the colour of the app's cards; in light mode it's a plain dark grey
// (the cards are white there, and light text on a white page would look faded).
const darkPage = () => ({
  background: getComputedStyle(document.documentElement).getPropertyValue("--dark-page").trim() || "#1b1e23",
  foreground: "#dfe3e8",
});

export async function openPdf(url, container, { zoom = 1, before = "", after = "", dark = false } = {}) {
  const { pdfjs, viewer: V } = await load();
  container.innerHTML = `${before}<div class="pdfViewer"></div>${after}`;
  const eventBus = new V.EventBus();
  const linkService = new V.PDFLinkService({ eventBus });
  const view = new V.PDFViewer({
    container, viewer: container.querySelector(".pdfViewer"), eventBus, linkService, textLayerMode: 1,
    pageColors: dark ? darkPage() : null,
  });
  linkService.setViewer(view);
  const doc = await pdfjs.getDocument(url).promise;
  const ready = new Promise((resolve) => eventBus.on("pagesinit", resolve, { once: true }));
  view.setDocument(doc);
  linkService.setDocument(doc, null);
  await ready;
  // "Fit" means the panel's width, but never wider than is comfortable to read (MAX_WIDTH).
  const pageWidth = (await doc.getPage(1)).getViewport({ scale: 1 }).width * CSS_PER_PDF_UNIT;
  const fitScale = () => {
    view.currentScaleValue = "page-width";
    return Math.min(view.currentScale, MAX_WIDTH / pageWidth);
  };
  let fit = fitScale(); // zoom is shown relative to this
  view.currentScale = fit;
  if (zoom !== 1) view.currentScale = fit * zoom;

  return {
    pageCount: doc.numPages,
    outline: await outline(doc),
    goTo: (dest) => linkService.goToDestination(dest),
    goToPage: (pageNumber) => view.scrollPageIntoView({ pageNumber }),
    get zoom() { return view.currentScale / fit; },
    // factor > 1 zooms in; origin is the [x, y] screen point that stays put (the cursor).
    // `smooth` (wheel and pinch) stretches the page at once and redraws it sharp a moment later,
    // so a stream of wheel ticks doesn't redraw on every tick; one-off steps redraw sharp right away.
    zoomBy(factor, origin, { smooth = false } = {}) {
      view.updateScale({ scaleFactor: factor, origin, drawingDelay: smooth ? 250 : -1 });
    },
    fitWidth() { fit = fitScale(); view.currentScale = fit; },
    onZoom(listener) { eventBus.on("scalechanging", () => listener(view.currentScale / fit)); },
    // Called each time a page is drawn (first time, after zooming, ...) with its number and element.
    onPageRendered(listener) { eventBus.on("pagerendered", ({ pageNumber, source }) => listener(pageNumber, source.div)); },
    // Called when a page's selectable text is ready (it can come after the page is drawn), with its text layer.
    onTextLayerRendered(listener) {
      eventBus.on("textlayerrendered", ({ pageNumber, source }) => listener(pageNumber, source.div.querySelector(".textLayer")));
    },
    get page() { return view.currentPageNumber; },
    // Scroll so that a point on a page (y as a fraction of its height) is near the top of the screen.
    showPoint(pageNumber, y = 0) {
      const div = container.querySelector(`.page[data-page-number="${pageNumber}"]`);
      if (!div) return;
      container.scrollTop += div.getBoundingClientRect().top - container.getBoundingClientRect().top + y * div.clientHeight - 120;
    },
    // PDF.js can throw while cancelling a page that is half drawn; closing must still go ahead.
    close() {
      try { view.setDocument(null); linkService.setDocument(null); } catch { /* already going away */ }
      doc.destroy();
    },
  };
}

// The PDF's own table of contents (two levels), as destinations the viewer can jump to.
async function outline(doc) {
  const found = [];
  const walk = (items, depth) => (items || []).forEach((item) => {
    if (item.dest) found.push({ title: item.title, depth, dest: item.dest });
    if (depth < 1) walk(item.items, depth + 1);
  });
  walk(await doc.getOutline(), 0);
  return found;
}
