// The two ways to read: the original PDF or the paper's reflowed text. Opening one, the "Go to…" list,
// coming back to where you stopped, and jumping to a note.
import { esc, loading, pct, toast } from "../../core.js";
import { drawPdf, drawPdfPage, drawText } from "../../highlights.js";
import { openPdf } from "../../pdfview.js";
import { pdfPagesDark } from "../../readprefs.js";
import { renderPaperText } from "../../textview.js";
import { paintView } from "./progress.js";
import { savedZoom, saveZoom } from "./zoom.js";

export function createViews(r, { notes, vocab, fitBar }) {
  const { id, paper: p, $, scroller } = r;
  const endBox = `<div class="article-end">${p.status === "read"
    ? `<p>You've finished this paper.</p>${p.quiz?.length ? `<a class="button secondary" href="#/papers/${id}/quiz">Test yourself</a>` : ""}`
    : `<p>That's the end of the paper.</p><button class="button" data-finish>Mark as finished</button>`}</div>`;
  let targets = []; // "Go to…" destinations for the current view: { label, go, page? }

  // Your notes and highlights, drawn on the paper.
  const drawMarks = () => (r.view === "text" ? drawText(scroller.querySelector("#article"), notes.items) : drawPdf(scroller, notes.items));
  notes.on(drawMarks);

  const show = async (next) => {
    r.settling = true;
    r.view = next;
    r.pdf?.close();
    r.pdf = null;
    r.$$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === r.view));
    scroller.className = `reader-scroll view-${r.view}`;
    if (r.view === "text") {
      const { html, headings } = renderPaperText(p);
      scroller.innerHTML = `<article class="page-sheet" id="article">${html}${endBox}</article>`;
      vocab.refresh(); // mark the hard words
      targets = headings.map((h) => ({
        label: `${h.level === 3 ? "  " : ""}${h.label}`, go: () => r.scrollToElement(scroller.querySelector(`#${h.id}`)),
      }));
    } else {
      scroller.innerHTML = loading("Opening the PDF");
      try {
        const pdf = r.pdf = await openPdf(`/api/papers/${id}/file`, scroller,
          { zoom: savedZoom(), after: endBox, dark: pdfPagesDark() });
        pdf.onZoom((zoom) => {
          $("#zoom .zoom-value").textContent = pct(zoom);
          saveZoom(zoom);
          paintView(r);
        });
        targets = [
          ...pdf.outline.map((o) => ({ label: `${o.depth ? "  " : ""}${o.title}`, go: () => pdf.goTo(o.dest) })),
          ...Array.from({ length: pdf.pageCount }, (_, i) => ({ label: `Page ${i + 1} of ${pdf.pageCount}`, go: () => pdf.goToPage(i + 1), page: true })),
        ];
      } catch (e) {
        scroller.innerHTML = `<p class="error pad">Couldn't open the PDF: ${esc(e.message)}</p>`;
        targets = [];
      }
    }
    const sections = targets.filter((t) => !t.page);
    const pages = targets.filter((t) => t.page);
    $("#jump").innerHTML = `<option value="">Go to…</option>
      ${sections.length ? `<optgroup label="Sections">${sections.map((t) => `<option value="${targets.indexOf(t)}">${esc(t.label)}</option>`).join("")}</optgroup>` : ""}
      ${pages.length ? `<optgroup label="Pages">${pages.map((t) => `<option value="${targets.indexOf(t)}">${esc(t.label)}</option>`).join("")}</optgroup>` : ""}`;
    $("#jump").hidden = !targets.length;
    $("#zoom").hidden = !r.pdf;
    $("#page-tone").hidden = r.view !== "pdf";
    $(".prefs-menu").hidden = r.view !== "text"; // text size, spacing and font only apply to the Text view
    if (r.pdf) $("#zoom .zoom-value").textContent = pct(r.pdf.zoom);
    if (r.pdf) r.pdf.onPageRendered((n, div) => drawPdfPage(div, n, notes.items));
    if (r.pdf) r.pdf.onTextLayerRendered((n, layer) => vocab.markPage(layer));
    drawMarks();
    setTimeout(() => (r.settling = false), 800); // callers put you back where you were in the meantime
    fitBar();
  };

  // Reopen the current view (or another) and stay at the same place in the paper.
  const reopen = async (next) => {
    const position = r.positionNow();
    await show(next);
    r.scrollToPosition(position);
  };

  // Back to where you stopped, unless you came to see a note or a page.
  // Returns the note to show once notes are loaded (-1: none, but don't go back to where you stopped).
  const restore = () => {
    let jumpTo = null;
    let toPage = null;
    try {
      jumpTo = Number(sessionStorage.getItem(`papers.jump.${id}`)) || null; sessionStorage.removeItem(`papers.jump.${id}`);
      toPage = Number(sessionStorage.getItem(`papers.page.${id}`)) || null; sessionStorage.removeItem(`papers.page.${id}`);
    } catch { /* none */ }
    if (toPage && r.pdf) { r.pdf.goToPage(toPage); jumpTo = jumpTo || -1; }
    if (r.saved > 0.01 && r.saved < 0.99 && !jumpTo) {
      r.scrollToPosition(r.saved);
      toast(`Back where you stopped, ${pct(r.saved)} in`);
    }
    return jumpTo;
  };

  // Go to a note: its exact spot when it's drawn in this view, otherwise its page or its place in the paper.
  const jumpToNote = (note) => {
    const mark = scroller.querySelector(`[data-note="${note.id}"]`);
    const rect = note.anchor?.rects?.[0];
    if (r.view === "pdf" && rect) r.pdf.showPoint(rect[0], rect[2]);
    else if (mark && r.view === "text") r.scrollToElement(mark);
    else if (r.view === "pdf" && note.page) r.pdf.goToPage(note.page);
    else r.scrollToPosition(note.position);
    const flash = () => scroller.querySelectorAll(`[data-note="${note.id}"]`).forEach((m) => {
      m.classList.remove("flash"); void m.offsetWidth; m.classList.add("flash");
    });
    setTimeout(flash, 120);
  };

  // The view switch, "Go to…", and dark pages (which reopen the PDF where you are).
  const bind = () => {
    $("#jump").onchange = (e) => {
      targets[e.target.value]?.go();
      e.target.value = "";
    };
    $("#views")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-view]");
      if (b && b.dataset.view !== r.view) reopen(b.dataset.view);
    });
    const onDarkPages = () => { if (r.view === "pdf") reopen("pdf"); };
    document.addEventListener("dark-pages-changed", onDarkPages);
    return () => document.removeEventListener("dark-pages-changed", onDarkPages);
  };

  return { show, reopen, restore, jumpToNote, bind };
}
