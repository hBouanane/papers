// The side panel: Ask (conversations with the AI about the paper, chat/conversation.js), Words (the paper's
// vocabulary) and Notes, one tab at a time. Drag its left edge to resize it, or use Wider; the width is remembered.
import { conversationView } from "../../chat/conversation.js";
import { api, renderVocab, toast } from "../../core.js";

const WIDTH_KEY = "papers.panelWidth";
const MIN = 340;
const maxWidth = () => Math.max(MIN, innerWidth - 320); // the paper keeps at least this much
const savedWidth = () => { try { return Number(localStorage.getItem(WIDTH_KEY)) || 420; } catch { return 420; } };
const saveWidth = (w) => { try { localStorage.setItem(WIDTH_KEY, String(Math.round(w))); } catch { /* not remembered */ } };

export function setupPanel(r, { notes, cite } = {}) {
  const { id, $ } = r;
  const panel = $("#notes");
  const isOpen = () => document.body.classList.contains("notes-open");
  const setOpen = (open, pane) => {
    document.body.classList.toggle("notes-open", open);
    if (!pane) return;
    r.$$(".panel-tabs [data-pane]").forEach((b) => b.setAttribute("aria-selected", b.dataset.pane === pane));
    r.$$(".pane").forEach((el) => (el.hidden = el.dataset.pane !== pane));
  };

  // ----- Width: drag the left edge, or Wider (narrow → wide → most of the screen) -----
  const setWidth = (w, remember = true) => {
    const width = Math.min(maxWidth(), Math.max(MIN, w));
    document.body.style.setProperty("--panel-w", `${width}px`);
    $("#panel-wider").textContent = width >= Math.min(maxWidth(), innerWidth * 0.6) - 4 ? "Narrower" : "Wider";
    if (remember) saveWidth(width);
  };
  setWidth(savedWidth(), false);
  $("#panel-wider").onclick = () => {
    const now = panel.offsetWidth;
    const steps = [420, Math.round(innerWidth * 0.45), Math.round(innerWidth * 0.62)];
    setWidth(steps.find((s) => s > now + 10) ?? steps[0]);
  };
  const handle = $("#panel-resize");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("panel-resizing");
    const move = (m) => setWidth(innerWidth - m.clientX, false);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      document.body.classList.remove("panel-resizing");
      saveWidth(panel.offsetWidth);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  });
  const onResize = () => setWidth(panel.offsetWidth, false);
  addEventListener("resize", onResize);

  // ----- Ask: conversations -----
  let figures = null;
  const chat = conversationView($("#chat"), {
    paperId: id,
    toast,
    // the paper's figures (cut out of the PDF the first time) for visuals; citations go where they point
    visuals: { figures: () => (figures ??= api(`/papers/${id}/figures`).catch(() => [])), onCite: cite },
    onSaveNote: async (body, quote) => {
      await notes.add({ kind: "note", body: body.slice(0, 6000), quote: quote.slice(0, 2000), position: r.positionNow?.() || 0 });
      toast("Saved to your notes.");
    },
  });

  // ----- Opening, closing and the tabs -----
  $(".panel-tabs").onclick = (e) => {
    const b = e.target.closest("[data-pane]");
    if (b) setOpen(true, b.dataset.pane);
  };
  const toggle = () => setOpen(!isOpen());
  $("#toggle-notes").onclick = toggle;
  $("#close-notes").onclick = () => setOpen(false);

  // ----- Words -----
  const renderWords = () => renderVocab($("#reader-vocab"), r.paper, { compact: true });

  return {
    setOpen,
    toggle,
    // Explain, Simplify or Translate a selected passage: a new conversation (label: where it's from).
    explain(passage, _question = "", mode = "explain", label = "") {
      setOpen(true, "ask");
      chat.start(mode, passage, label);
    },
    // Attach a selected passage to the next message.
    attach(passage, label = "") {
      setOpen(true, "ask");
      chat.attach(passage, label);
    },
    renderWords,
    // A newly made vocabulary, or a word marked as known (or shown again), changes the marks in the page.
    onWordsChanged(refresh) {
      const vocab = $("#reader-vocab");
      vocab.addEventListener("click", () => setTimeout(refresh, 0));
      vocab.addEventListener("known-changed", refresh);
    },
    cleanup() {
      document.body.classList.remove("notes-open");
      document.body.style.removeProperty("--panel-w");
      removeEventListener("resize", onResize);
    },
  };
}
