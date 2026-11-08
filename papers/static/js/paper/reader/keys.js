// Keyboard shortcuts in the reader. Returns a function that removes them.
import { showShortcuts, toast } from "../../core.js";
import { toggleDarkPages } from "../../readprefs.js";

const HELP = [
  ["s", "Skimming on or off (nothing counts while it's on)"], ["w", "Mark the hard words on or off"], ["d", "Dark PDF pages on or off"], ["n", "Open or close Ask, Words and Notes"],
  ["e", "Explain the selected text"], ["h", "Highlight the selected text, or turn the highlighter on and off"], ["l", "Listen to the selected text"],
  ["+ −", "Zoom the PDF (or Ctrl + mouse wheel, or pinch)"],
];

export function bindKeys(r, { progress, panel, selection, highlighter, zoom, vocab }) {
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "s") progress.toggleSkimming();
    else if (e.key === "w") vocab.toggle();
    else if (e.key === "n") panel.toggle();
    else if (e.key === "e" && selection.isOpen()) selection.press("explain");
    else if (e.key === "l" && selection.isOpen()) selection.press("listen");
    else if (e.key === "h") { if (selection.isOpen()) selection.press("highlight"); else highlighter.toggleTool(); }
    else if (e.key === "Escape") { if (!highlighter.stop()) return; }
    else if ((e.key === "+" || e.key === "=") && r.pdf) zoom.zoomIn();
    else if (e.key === "-" && r.pdf) zoom.zoomOut();
    else if (e.key === "d" && r.pdf) toast(toggleDarkPages() ? "Dark pages on (press d to turn off)." : "Dark pages off.");
    else if (e.key === "?") showShortcuts(HELP);
    else return;
    e.preventDefault();
  };
  addEventListener("keydown", onKey);
  return () => removeEventListener("keydown", onKey);
}
