// Words in the reader: the Words switch in the bar marks the paper's hard words (its vocabulary, written by the
// AI or saved by you) right in the page, and clicking one opens a small card with what it means here, its
// translation, where the paper uses it, and Listen / I know this. The switch is remembered; it starts on.
import { esc, knownWords, setKnown, toast } from "../../core.js";
import { canSpeak, speak } from "../../speech.js";
import { markPdfPage, markText, unmarkWords } from "./terms.js";

const KEY = "papers.showVocab";
const saved = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
const remember = (on) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* not remembered */ } };

export function setupVocab(r) {
  const { paper: p, $, scroller } = r;
  const toggle = $("#vocab-toggle");
  const card = $("#word-card");
  let open = null; // the <abbr> the card is open for

  // The words to mark: the paper's vocabulary, minus the ones you know.
  const words = () => {
    const known = knownWords();
    return (p.glossary || []).filter((w) => !known.has(w.term.toLowerCase()));
  };
  const find = (key) => (p.glossary || []).find((w) => w.term.toLowerCase() === key);

  // Bring the marks in line with the vocabulary: drop the ones for words you know, add new ones.
  const refresh = () => {
    const list = words();
    const keep = new Set(list.map((w) => w.term.toLowerCase()));
    unmarkWords(scroller, keep);
    if (r.view === "text") {
      const article = scroller.querySelector("#article");
      if (article) markText(article, list);
    } else {
      scroller.querySelectorAll(".textLayer").forEach((layer) => markPdfPage(layer, list));
    }
  };
  // A PDF page's text appears (or is drawn again) after the page itself.
  const markPage = (layer) => markPdfPage(layer, words());

  const setOn = (on) => {
    document.body.classList.toggle("vocab-on", on);
    toggle.setAttribute("aria-checked", on);
    remember(on);
    if (!on) close();
  };
  toggle.onclick = () => {
    const on = !document.body.classList.contains("vocab-on");
    setOn(on);
    if (on && !(p.glossary || []).length) toast("This paper has no vocabulary yet. Open Words in Ask & notes to make it.");
  };
  setOn(saved());

  // ---------- The card ----------
  function close() { // a declaration: setOn() above can call it while the reader starts
    card.hidden = true;
    open?.classList.remove("open");
    open = null;
  }
  const place = (abbr) => {
    const rect = abbr.getBoundingClientRect();
    const w = card.offsetWidth, h = card.offsetHeight;
    const below = rect.bottom + 10 + h < innerHeight;
    card.style.top = `${below ? rect.bottom + 10 : Math.max(8, rect.top - h - 10)}px`;
    card.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2))}px`;
  };
  const show = (abbr) => {
    const w = find(abbr.dataset.term);
    if (!w) return;
    open?.classList.remove("open");
    open = abbr;
    abbr.classList.add("open");
    card.innerHTML = `
      <div class="word-card-head"><strong class="word-card-term">${esc(w.term)}</strong>
        <span class="chip">${w.kind === "english" ? "English" : "Technical"}</span></div>
      <p class="word-card-meaning">${esc(w.meaning)}</p>
      ${w.translation ? `<p class="word-card-translation"><span class="faint">${esc(r.language || "Translation")}:</span> ${esc(w.translation)}</p>` : ""}
      ${w.example ? `<p class="word-card-example">“${esc(w.example)}”</p>` : ""}
      <div class="word-card-actions">
        ${canSpeak() ? `<button class="button quiet small" data-word="listen">Listen</button>` : ""}
        <button class="button secondary small" data-word="known">I know this</button></div>`;
    card.hidden = false;
    place(abbr);
  };
  card.addEventListener("click", (e) => {
    const action = e.target.closest("[data-word]")?.dataset.word;
    if (!action || !open) return;
    const w = find(open.dataset.term);
    if (action === "listen") return speak(w.term);
    setKnown(w.term, true);
    close();
    refresh();
    r.$("#reader-vocab")?.dispatchEvent(new CustomEvent("known-changed")); // the Words panel shows it as known
    toast(`Marked “${w.term}” as known. Show it again from Words in Ask & notes.`);
  });

  const onDown = (e) => { if (!card.hidden && !card.contains(e.target) && e.target !== open) close(); };
  const onKey = (e) => { if (e.key === "Escape" && !card.hidden) { close(); e.stopPropagation(); } };
  addEventListener("mousedown", onDown);
  addEventListener("keydown", onKey, true);
  scroller.addEventListener("scroll", close, { passive: true });

  return {
    refresh,
    markPage,
    // A click on the page: open the card if it's on a marked word (and the switch is on).
    openAt(e) {
      const abbr = e.target.closest?.("abbr.term");
      if (!abbr || !document.body.classList.contains("vocab-on")) return false;
      if (abbr === open) close(); else show(abbr);
      return true;
    },
    toggle: () => toggle.click(),
    cleanup() {
      removeEventListener("mousedown", onDown);
      removeEventListener("keydown", onKey, true);
      document.body.classList.remove("vocab-on");
    },
  };
}
