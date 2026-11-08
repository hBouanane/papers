// What every part of the reader shares: the paper, the page's elements, the open view, and where you are in it.
import { app } from "../../core.js";

export function readerState({ id, paper, language, view }) {
  const $ = (sel) => app.querySelector(sel);
  // The paper scrolls in this panel (both views), below the reader bar.
  const scroller = $("#scroller");
  const maxScroll = () => Math.max(1, scroller.scrollHeight - scroller.clientHeight);
  return {
    id, paper, language,
    $, $$: (sel) => app.querySelectorAll(sel), scroller,
    view, // "pdf" or "text"
    pdf: null, // the open PDF (pdfview.js) in PDF view
    saved: paper.position, // where you stopped, as the server knows it
    settling: false, // true while a view (re)opens and the page is briefly short or empty
    maxScroll,
    positionNow: () => Math.min(1, Math.max(0, scroller.scrollTop / maxScroll())),
    scrollToPosition: (position) => (scroller.scrollTop = position * maxScroll()),
    scrollToElement: (el) =>
      (scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16),
  };
}
