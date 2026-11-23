// The reader: the PDF (or the paper's text), with selection tools (explain, translate, highlight, note),
// reading progress, read-aloud and the bar on top. Each part lives in ./reader/; this file opens the paper
// and wires the parts together. They share `r` (reader/state.js): the paper, the page's elements, the view.
import { api, app, go, loading, toast } from "../core.js";
import { bindNotesList, noteStore } from "../notes.js";
import { bindReadingPrefs } from "../readprefs.js";
import { stopSpeaking } from "../speech.js";
import { setupBar } from "./reader/bar.js";
import { setupFinish } from "./reader/finish.js";
import { setupGuide } from "./reader/guide.js";
import { setupHighlighter } from "./reader/highlighter.js";
import { bindKeys } from "./reader/keys.js";
import { readerHtml } from "./reader/layout.js";
import { citeHandler } from "./reader/cite.js";
import { setupPanel } from "./reader/panel.js";
import { setupProgress } from "./reader/progress.js";
import { setupRoute } from "./reader/route.js";
import { setupSelection } from "./reader/selection.js";
import { readerState } from "./reader/state.js";
import { createViews } from "./reader/views.js";
import { setupVocab } from "./reader/vocab.js";
import { setupZoom } from "./reader/zoom.js";

// /papers/:id/guide/:mid (or /guide/new): the reader, opened on the in-depth guide.
export const guidePage = (id, mid, stale) => readerPage(id, stale, { guide: Number.isNaN(mid) ? "new" : mid });

export async function readerPage(id, stale, { guide: openOnGuide = null } = {}) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  let p = await api(`/papers/${id}`);
  if (stale()) return;
  if (p.can_fetch_pdf) {
    app.innerHTML = `<div class="container page">${loading("Getting the original PDF (only the first time)")}</div>`;
    try { p = await api(`/papers/${id}/fetch-pdf`, { method: "POST" }); }
    catch (e) { toast(`Couldn't get the original PDF, showing the text instead. ${e.message}`); }
    if (stale()) return;
  }
  if (!p.text && !p.has_pdf) { go(`/papers/${id}`, true); return; }
  const { language, ai_pages: allowPages } = await api("/settings").catch(() => ({ language: "" }));
  if (stale()) return;
  document.body.classList.add("reading");
  app.innerHTML = readerHtml(p, id, language);

  // The original PDF is the default; small screens get the reflowed text when there is some.
  const r = readerState({ id, paper: p, language, view: p.has_pdf && (innerWidth >= 700 || !p.text) ? "pdf" : "text" });
  const bar = setupBar(r);
  setupRoute(r);
  // A scan is pictures of pages: it can be read, but there are no words to select, highlight or explain.
  if (p.has_pdf && !p.text && !p.preparing) {
    setTimeout(() => toast("This PDF is a scan (pictures of pages), so its text can't be selected or explained. A version with real text will work."), 1200);
  }
  const notes = noteStore(id);
  const vocab = setupVocab(r);
  const views = createViews(r, { notes, vocab, fitBar: bar.fit });

  // Open the paper, then go back to where you stopped (or to the note you came to see).
  await views.show(r.view);
  if (stale()) { r.pdf?.close(); bar.cleanup(); vocab.cleanup(); return; }
  const jumpTo = views.restore({ quiet: !!openOnGuide });
  // Deep mode can change the library (a note, a highlight, a word): show it right away.
  const libraryChanged = async (kind) => {
    if (kind === "note" || kind === "highlight") return notes.load().catch(() => {});
    if (kind === "word") {
      const fresh = await api(`/papers/${id}`).catch(() => null);
      if (fresh) { p.glossary = fresh.glossary; panel.renderWords(); vocab.refresh(); }
    }
  };
  const cite = citeHandler(r, views);
  let guide = null;
  const panel = setupPanel(r, { notes, cite, allowPages, onLibraryChanged: (kind) => libraryChanged(kind), onScreen: () => guide?.shown() });
  guide = setupGuide(r, {
    cite, toPaper: () => views.toPaper(), onShown: () => { vocab.refresh(); views.refreshJump(); },
    onChange: () => panel.chat.redraw(), // the guide on screen isn't repeated in the chat beside it
  });
  // Over the guide: a box to ask about it. The answer opens beside the guide, in the guide's own conversation.
  r.$("#guide-ask").onsubmit = (e) => {
    e.preventDefault();
    const input = r.$("#guide-ask-text");
    const text = input.value.trim();
    if (!text) return input.focus();
    input.value = "";
    panel.setOpen(true, "ask");
    panel.chat.askIn(guide.shown()?.conversation ?? null, text);
  };
  r.$("#guide-ask-new").onclick = () => { panel.setOpen(true, "ask"); panel.chat.newChat(); };
  views.useGuide(guide);
  const notesUi = bindNotesList(r.$("#notes-list"), notes, {
    here: () => ({ position: r.positionNow(), page: r.pdf ? r.pdf.page : null }),
    jump: (note) => views.jumpToNote(note),
  });
  notes.load().then(() => {
    const note = jumpTo && notes.items.find((n) => n.id === jumpTo);
    if (note) { views.jumpToNote(note); panel.setOpen(true, "notes"); }
  }).catch((e) => toast(e.message));

  const progress = setupProgress(r);
  const unbindViews = views.bind();
  const highlighter = setupHighlighter(r, { notes, notesUi, setOpen: panel.setOpen });
  const selection = setupSelection(r, { highlighter, notesUi, panel, vocab });
  setupFinish(r, { flush: progress.flush });
  panel.renderWords();
  panel.onWordsChanged(vocab.refresh);
  const zoom = setupZoom(r);
  const unbindKeys = bindKeys(r, { progress, panel, selection, highlighter, zoom, vocab, guide });
  bindReadingPrefs(r.$("#bar"));
  if (openOnGuide) views.openGuide(openOnGuide);
  // A long answer in the chat opens here as the guide view.
  const onOpenGuide = (e) => { e.preventDefault(); panel.setOpen(false); views.openGuide(e.detail, { exact: true }); };
  addEventListener("open-guide", onOpenGuide);

  return () => {
    stopSpeaking();
    guide.cleanup();
    removeEventListener("open-guide", onOpenGuide);
    document.body.classList.remove("guide-view");
    unbindKeys();
    notesUi.destroy();
    highlighter.cleanup();
    unbindViews();
    progress.cleanup();
    bar.cleanup();
    r.pdf?.close();
    panel.cleanup();
    vocab.cleanup();
  };
}
