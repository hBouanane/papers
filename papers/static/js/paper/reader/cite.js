// Where a citation in an answer takes you: [p. 5] to the page (in the PDF), [§3.4] to the section (its heading in
// the text, or the PDF's own table of contents), [Fig. 1] and [Table 2] open large beside the chat.
import { toast } from "../../core.js";

export function citeHandler(r, views) {
  return async (kind, ref, ctx) => {
    const n = (ref.match(/\d+(?:\.\d+)*/) || [])[0];
    if (!n) return;
    if (kind === "figure" || kind === "table") {
      return ctx.onOpen(kind === "table" ? "figure" : kind, { [kind]: Number(n) }, `${kind === "table" ? "Table" : "Figure"} ${n}`);
    }
    if (kind === "page") {
      if (!r.pdf && r.paper.has_pdf) await views.reopen("pdf");
      return r.pdf ? r.pdf.goToPage(Number(n)) : toast("Page numbers point into the PDF, and this paper has none.");
    }
    if (kind === "section") {
      const num = n.replace(/\./g, "\\.");
      const starts = (title) => new RegExp(`^${num}(\\.|\\s|$)`).test(title.trim());
      const inText = new RegExp(`(?:^|\\s)${num}\\s+[A-Z][a-z]`); // "3.5 Positional Encoding" inside running text
      if (r.view === "text") {
        // its heading, or the paragraph it's in (headings the PDF's text merged into a paragraph)
        const h = [...r.scroller.querySelectorAll("#article h2, #article h3, #article h4")].find((x) => starts(x.textContent))
          || [...r.scroller.querySelectorAll("#article p")].find((x) => inText.test(x.textContent));
        if (h) return r.scrollToElement(h);
      } else if (r.pdf) {
        const o = r.pdf.outline.find((x) => starts(x.title));
        if (o) return r.pdf.goTo(o.dest);
        // no table of contents in this PDF: where the heading is in the paper's text, as a share of the paper
        const at = (r.paper.text || "").search(inText);
        if (at >= 0) return r.scrollToPosition(at / r.paper.text.length);
      }
      return toast(`Couldn't find section ${n} in this paper.`);
    }
    toast("That points to an equation; look near the passage the answer is about.");
  };
}
