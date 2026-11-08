// Zooming the PDF: the − 100% + buttons, and Ctrl + wheel or a pinch around the pointer.
const ZOOM_KEY = "papers.pdfZoom";
export const savedZoom = () => { try { return Number(localStorage.getItem(ZOOM_KEY)) || 1; } catch { return 1; } };
export const saveZoom = (z) => { try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* not remembered */ } };

export function setupZoom(r) {
  const { scroller } = r;
  // Buttons and keys zoom around the middle of the paper.
  const middle = () => {
    const box = scroller.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  };
  const by = (factor) => r.pdf?.zoomBy(factor, middle());
  r.$("#zoom").onclick = (e) => {
    const z = e.target.closest("[data-zoom]")?.dataset.zoom;
    if (!r.pdf || !z) return;
    if (z === "fit") r.pdf.fitWidth();
    else by(z === "in" ? 1.25 : 0.8);
  };
  // Trackpad pinches arrive as Ctrl + wheel too; small deltas give small, smooth steps.
  scroller.addEventListener("wheel", (e) => {
    if (!r.pdf || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY / 300)));
    r.pdf.zoomBy(factor, [e.clientX, e.clientY], { smooth: true });
  }, { passive: false });

  return { zoomIn: () => by(1.25), zoomOut: () => by(0.8) };
}
