// The original PDF, shown with PDF.js's own viewer component (the one Firefox uses).
// It draws only the pages near the screen, keeps a selectable text layer, follows links inside the
// PDF (like citations), and zooms smoothly: pages are stretched at once and redrawn sharp shortly
// after, around the point you zoom at.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168";
const MAX_WIDTH = 920; // px: wider pages are hard to read line by line
const CSS_PER_PDF_UNIT = 96 / 72; // PDF.js scale 1 shows a page at 96 dpi
let libs;

async function load() {
  if (!libs) {
    const pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
    globalThis.pdfjsLib = pdfjs; // the viewer module reads the library from here
    libs = { pdfjs, viewer: await import(`${PDFJS}/pdf_viewer.mjs`) };
  }
  return libs;
}

// `container` must be absolutely positioned and scrollable; the viewer scrolls inside it.
// `after` is HTML placed below the last page (e.g. an end-of-paper box).
export async function openPdf(url, container, { zoom = 1, after = "" } = {}) {
  const { pdfjs, viewer: V } = await load();
  container.innerHTML = `<div class="pdfViewer"></div>${after}`;
  const eventBus = new V.EventBus();
  const linkService = new V.PDFLinkService({ eventBus });
  const view = new V.PDFViewer({ container, viewer: container.firstElementChild, eventBus, linkService, textLayerMode: 1 });
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
    close() { view.setDocument(null); linkService.setDocument(null); doc.destroy(); },
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
