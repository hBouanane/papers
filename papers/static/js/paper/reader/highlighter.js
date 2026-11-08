// Highlights: adding one from a selection, the highlighter tool (like a real marker: select text and it's
// highlighted, no menu), and the popover on a highlight you click (change its colour, add a note, remove it).
import { toast } from "../../core.js";
import { pdfAnchor, textAnchor } from "../../highlights.js";

const TOOL_KEY = "papers.highlighter";

// The mouse pointer while the highlighter is on: a marker in the chosen colour.
const cursorFor = (color) => {
  const fill = getComputedStyle(document.documentElement).getPropertyValue(`--dot-${color}`).trim() || "#f0c000";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M4 22l2.5-6.5L17 5l4 4-10.5 10.5z' fill='${fill}' stroke='#1b1e23' stroke-width='1.4' stroke-linejoin='round'/><path d='M4 22l2.5-6.5 4 4z' fill='#1b1e23'/><path d='M15 7l4 4' stroke='#1b1e23' stroke-width='1.4'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 22`;
};

export function setupHighlighter(r, { notes, notesUi, setOpen }) {
  const { $, scroller } = r;

  // Save a highlight for a range of the paper, anchored to the PDF page or to the text.
  const add = async (range, text, color) => {
    const box = range.getBoundingClientRect();
    const y = scroller.scrollTop + box.top - scroller.getBoundingClientRect().top - 120;
    const position = Math.min(1, Math.max(0, y / r.maxScroll()));
    let anchor = null;
    if (r.view === "pdf") {
      anchor = pdfAnchor(range, scroller);
      if (!anchor) return toast("Couldn't place that highlight on the page.");
    } else anchor = textAnchor(scroller.querySelector("#article"), range);
    try {
      return await notes.add({ kind: "highlight", quote: text, color, position, page: anchor.rects?.[0]?.[0] ?? null, anchor });
    } catch (err) { toast(err.message); }
  };

  // ----- The highlighter tool -----
  const tool = (() => { try { return { on: false, color: "yellow", ...JSON.parse(localStorage.getItem(TOOL_KEY) || "{}") }; } catch { return { on: false, color: "yellow" }; } })();
  const paintTool = () => {
    $("#hl-toggle").setAttribute("aria-pressed", tool.on);
    $("#hl-tool").classList.toggle("on", tool.on);
    $("#hl-tool-dot").className = `hl-dot hl-${tool.color}`;
    r.$$("[data-tool-color]").forEach((b) => b.classList.toggle("active", b.dataset.toolColor === tool.color));
    scroller.classList.toggle("highlighting", tool.on);
    scroller.style.setProperty("--hl-cursor", cursorFor(tool.color));
    try { localStorage.setItem(TOOL_KEY, JSON.stringify(tool)); } catch { /* not remembered */ }
  };
  const setTool = (on) => {
    tool.on = on;
    paintTool();
    if (on) { $("#pop").hidden = true; toast(`Highlighter on: select text to highlight it ${tool.color}. Esc to stop.`); }
  };
  $("#hl-toggle").onclick = () => setTool(!tool.on);
  $("#hl-tool").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool-color]");
    if (!b) return;
    tool.color = b.dataset.toolColor;
    if (!tool.on) setTool(true); else paintTool();
  });
  // With the tool on, whatever you select is highlighted straight away.
  const highlightSelection = async () => {
    const sel = getSelection();
    const text = sel.toString().trim();
    if (text.length < 2 || !sel.rangeCount || !scroller.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0).cloneRange();
    sel.removeAllRanges();
    await add(range, text, tool.color);
  };

  // ----- Click a highlight on the page -----
  const hlPop = $("#hl-pop");
  let picked = null; // the note whose highlight was clicked
  const highlightAt = (e) => {
    const mark = e.target.closest?.("mark.hl[data-note]");
    if (mark) return { id: Number(mark.dataset.note), box: mark.getBoundingClientRect() };
    // In the PDF the marks sit under the text, so find the one under the pointer by its position.
    for (const el of scroller.querySelectorAll(".hl-layer .hl")) {
      const box = el.getBoundingClientRect();
      if (e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top - 2 && e.clientY <= box.bottom + 2) return { id: Number(el.dataset.note), box };
    }
    return null;
  };
  const openHighlight = (hit) => {
    picked = notes.items.find((n) => n.id === hit.id);
    if (!picked) return;
    hlPop.querySelectorAll("[data-hl-color]").forEach((b) => b.classList.toggle("active", b.dataset.hlColor === picked.color));
    hlPop.querySelector("[data-hl-act=note]").textContent = picked.body ? "Edit note" : "Note";
    hlPop.hidden = false;
    const top = scroller.getBoundingClientRect().top;
    hlPop.style.top = `${Math.max(hit.box.top - hlPop.offsetHeight - 10, top + 6)}px`;
    hlPop.style.left = `${Math.min(innerWidth - hlPop.offsetWidth - 8, Math.max(8, hit.box.left + hit.box.width / 2 - hlPop.offsetWidth / 2))}px`;
  };
  const closeHighlight = () => { hlPop.hidden = true; picked = null; };
  hlPop.addEventListener("click", async (e) => {
    if (!picked) return;
    const note = picked;
    const color = e.target.closest("[data-hl-color]")?.dataset.hlColor;
    const act = e.target.closest("[data-hl-act]")?.dataset.hlAct;
    closeHighlight();
    if (color && color !== note.color) await notes.edit(note.id, { color }).catch((err) => toast(err.message));
    if (act === "note") { setOpen(true, "notes"); notesUi.edit(note.id); }
    if (act === "remove") {
      await notes.remove(note.id).catch((err) => toast(err.message));
      toast("Highlight removed.", { label: "Undo", run: () => {
        const { kind, body, quote, color: c, page, position, anchor } = note;
        notes.add({ kind, body, quote, color: c, page, position, anchor }).catch((err) => toast(err.message));
      } });
    }
  });
  const onOutside = (e) => { if (!hlPop.hidden && !hlPop.contains(e.target)) closeHighlight(); };
  document.addEventListener("mousedown", onOutside);
  scroller.addEventListener("scroll", () => { if (!hlPop.hidden) closeHighlight(); }, { passive: true });

  paintTool();

  return {
    tool,
    add,
    highlightSelection,
    toggleTool: () => setTool(!tool.on),
    // Opens the popover for the highlight under a click; false when there's none.
    openAt(e) {
      const hit = highlightAt(e);
      if (hit) openHighlight(hit);
      return Boolean(hit);
    },
    // Esc: close the popover and put the highlighter down. False when there was nothing to stop.
    stop() {
      if (!tool.on && hlPop.hidden) return false;
      closeHighlight();
      if (tool.on) setTool(false);
      return true;
    },
    cleanup() { document.removeEventListener("mousedown", onOutside); },
  };
}
