// Select text in the paper to highlight, note, explain, simplify, translate, hear or save it as a word.
// Clicking the paper also opens a highlight's popover, or the card of a marked word (vocab.js).
import { api, toast } from "../../core.js";
import { speak, speaking, stopSpeaking } from "../../speech.js";

// The sentence a selection sits in, sent along when saving a word.
const sentenceAround = (range) => {
  const block = range.startContainer.parentElement?.closest("p, li, .textLayer");
  const all = (block?.textContent || "").replace(/\s+/g, " ");
  const at = all.indexOf(range.toString().trim().split(/\s+/)[0]);
  if (at < 0) return range.toString();
  const start = Math.max(all.lastIndexOf(". ", at) + 2, 0);
  const end = all.indexOf(". ", at);
  return all.slice(start, end < 0 ? undefined : end + 1).slice(0, 400);
};

export function setupSelection(r, { highlighter, notesUi, panel, vocab }) {
  const { id, paper: p, language, $, scroller } = r;
  const pop = $("#pop");
  let selection = null; // { text, range, sentence }

  const showSelectionBar = () => {
    const sel = getSelection();
    const text = sel.toString().trim();
    if (text.length < 2 || !sel.rangeCount || !scroller.contains(sel.anchorNode)) { pop.hidden = true; selection = null; return; }
    const range = sel.getRangeAt(0);
    selection = { text, range: range.cloneRange(), sentence: sentenceAround(range) };
    pop.querySelector("[data-sel=word]").hidden = text.split(/\s+/).length > 4;
    pop.hidden = false;
    const rect = range.getBoundingClientRect();
    const width = pop.offsetWidth;
    const top = scroller.getBoundingClientRect().top;
    pop.style.top = `${Math.max(rect.top - pop.offsetHeight - 10, top + 6)}px`;
    pop.style.left = `${Math.min(innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))}px`;
  };
  scroller.addEventListener("mouseup", () => setTimeout(() => (highlighter.tool.on ? highlighter.highlightSelection() : showSelectionBar())));
  scroller.addEventListener("keyup", (e) => e.shiftKey && setTimeout(showSelectionBar));
  scroller.addEventListener("scroll", () => (pop.hidden = true), { passive: true });
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection while clicking

  // Mark explained passages in the reflowed text; the PDF text layer is absolutely positioned, so leave it alone.
  const markExplained = (range) => {
    if (r.view !== "text") return;
    try {
      const mark = document.createElement("mark");
      mark.className = "explained";
      range.surroundContents(mark);
    } catch { /* selection spans paragraphs; skip the inline highlight */ }
  };

  pop.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-sel]")?.dataset.sel;
    if (!action || !selection) return;
    const { text, range, sentence } = selection;
    if (action === "listen") {
      if (speaking()) return stopSpeaking();
      const button = e.target.closest("button");
      button.textContent = "Stop";
      return speak(text, { onEnd: () => (button.textContent = "Listen") });
    }
    pop.hidden = true;
    getSelection().removeAllRanges();
    if (action === "highlight" || action === "note") {
      const note = await highlighter.add(range, text, action === "note" ? "yellow" : e.target.closest("[data-color]").dataset.color);
      if (note && action === "note") { panel.setOpen(true, "notes"); notesUi.edit(note.id); }
      return;
    }
    if (action === "word") {
      toast(`Adding "${text}" to the vocabulary…`);
      try {
        p.glossary = await api(`/papers/${id}/words`, { method: "POST", json: { term: text, context: sentence } });
        panel.renderWords();
        vocab.refresh(); // marked in the page right away
        const w = p.glossary.find((x) => x.term.toLowerCase() === text.toLowerCase());
        panel.setOpen(true, "words");
        toast(w ? `${w.term}: ${w.meaning}` : "Added.");
      } catch (err) { toast(err.message); }
      return;
    }
    if (action === "translate" && !language) return toast("Set your language in Settings first, then Translate works.");
    markExplained(range);
    panel.explain(text, "", action);
  });

  scroller.addEventListener("click", (e) => {
    if (e.target.closest("[data-finish]")) return; // finish.js
    if (getSelection().toString().trim()) return;
    if (highlighter.openAt(e)) return;
    vocab.openAt(e); // a marked word: what it means
  });

  return {
    isOpen: () => !pop.hidden,
    // Press one of the bar's buttons (for keyboard shortcuts).
    press: (action) => pop.querySelector(`[data-sel=${action}]`)?.click(),
  };
}
