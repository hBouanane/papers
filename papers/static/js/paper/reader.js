// The reader: the PDF (or the paper's text), with selection tools (explain, translate, highlight, note),
// reading progress, read-aloud and the bar on top. Each part lives in ./reader/; this file opens the paper
// and wires the parts together. They share `r` (reader/state.js): the paper, the page's elements, the view.
import { api, app, loading, toast } from "../core.js";
import { bindNotesList, noteStore } from "../notes.js";
import { bindReadingPrefs } from "../readprefs.js";
import { stopSpeaking } from "../speech.js";
import { setupBar } from "./reader/bar.js";
import { setupFinish } from "./reader/finish.js";
import { setupHighlighter } from "./reader/highlighter.js";
import { bindKeys } from "./reader/keys.js";
import { readerHtml } from "./reader/layout.js";
import { setupPanel } from "./reader/panel.js";
import { setupProgress } from "./reader/progress.js";
import { setupRoute } from "./reader/route.js";
import { setupSelection } from "./reader/selection.js";
import { readerState } from "./reader/state.js";
import { createViews } from "./reader/views.js";
import { setupZoom } from "./reader/zoom.js";

export async function readerPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  let p = await api(`/papers/${id}`);
  if (stale()) return;
  if (p.can_fetch_pdf) {
    app.innerHTML = `<div class="container page">${loading("Getting the original PDF (only the first time)")}</div>`;
    try { p = await api(`/papers/${id}/fetch-pdf`, { method: "POST" }); }
    catch (e) { toast(`Couldn't get the original PDF, showing the text instead. ${e.message}`); }
    if (stale()) return;
  }
  if (!p.text && !p.has_pdf) { location.replace(`#/papers/${id}`); return; }
  const { language } = await api("/settings").catch(() => ({ language: "" }));
  if (stale()) return;
  document.body.classList.add("reading");
  app.innerHTML = readerHtml(p, id, language);

  // The original PDF is the default; small screens get the reflowed text when there is some.
  const r = readerState({ id, paper: p, language, view: p.has_pdf && (innerWidth >= 700 || !p.text) ? "pdf" : "text" });
  const bar = setupBar(r);
  setupRoute(r);
  const notes = noteStore(id);
  const views = createViews(r, { notes, fitBar: bar.fit });

  // Open the paper, then go back to where you stopped (or to the note you came to see).
  await views.show(r.view);
  if (stale()) { r.pdf?.close(); bar.cleanup(); return; }
  const jumpTo = views.restore();
  const panel = setupPanel(r);
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
  const selection = setupSelection(r, { highlighter, notesUi, panel });
  setupFinish(r, { flush: progress.flush });
  panel.renderWords();
  panel.onWordsChanged(() => views.reopen("text"));
  const zoom = setupZoom(r);
  const unbindKeys = bindKeys(r, { progress, panel, selection, highlighter, zoom });
  bindReadingPrefs(r.$("#bar"));

  return () => {
    stopSpeaking();
    unbindKeys();
    notesUi.destroy();
    highlighter.cleanup();
    unbindViews();
    progress.cleanup();
    bar.cleanup();
    r.pdf?.close();
    panel.cleanup();
  };
}
