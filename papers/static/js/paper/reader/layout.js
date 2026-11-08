// The reader's markup: the bar on top, the scrolling paper, the route pill, the side panel and the popovers.
import { esc } from "../../core.js";
import { COLORS } from "../../notes.js";
import { pageToneControl, readingPrefsMenu } from "../../readprefs.js";
import { canSpeak } from "../../speech.js";

const named = (c) => c[0].toUpperCase() + c.slice(1);

export const readerHtml = (p, id, language) => `
    <div class="reader-bar" id="bar">
      <div class="reader-bar-inner">
        <a href="#/papers/${id}" class="reader-back" title="Back to ${esc(p.title)}" aria-label="Back to the paper's page"><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="reader-back-label">Paper</span></a>
        ${p.has_pdf && p.text ? `<div class="segmented small" role="group" aria-label="View" id="views">
          <button data-view="pdf">Original</button><button data-view="text">Text</button></div>` : ""}
        <select id="jump" class="jump" aria-label="Go to a section or page"><option value="">Go to…</option></select>
        <div class="zoom" id="zoom" role="group" aria-label="Zoom" hidden>
          <button class="button quiet small" data-zoom="out" title="Zoom out (−)">−</button>
          <button class="button quiet small zoom-value num" data-zoom="fit" title="Fit to width">100%</button>
          <button class="button quiet small" data-zoom="in" title="Zoom in (+)">+</button></div>
        <div class="hl-tool" id="hl-tool" role="group" aria-label="Highlighter">
          <button class="hl-tool-btn" id="hl-toggle" aria-pressed="false" title="Highlighter: select text to highlight it at once (h, Esc to stop)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg><span class="hl-dot" id="hl-tool-dot"></span></button>
          <span class="hl-tool-colors">${COLORS.map((c) => `<button class="hl-dot hl-${c}" data-tool-color="${c}" aria-label="${c}" title="${named(c)}"></button>`).join("")}</span>
        </div>
        ${readingPrefsMenu()}
        <button class="switch" id="skim" role="switch" aria-checked="false" title="Skim freely: nothing you do counts as reading (s)"><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Skimming</span></button>
        <button class="switch" id="vocab-toggle" role="switch" aria-checked="true" title="Mark the paper's hard words; click one to see what it means (w)"><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Words</span></button>
        ${pageToneControl()}
        <details class="menu bar-more" id="bar-more" hidden><summary class="button secondary small" title="More tools" aria-label="More tools">⋯</summary>
          <div class="menu-list sheet bar-more-list" id="bar-more-list"></div></details>
        <span class="reader-pct num" id="pct" title="How much you've actually read. Fast scrolling and jumps don't count."></span>
        <button class="button secondary small" id="toggle-notes" title="Ask the AI, words, your notes (n)">Ask &amp; notes</button>
      </div>
      <div class="strip" id="strip" title="Parts you've read. Click to jump."><span class="strip-view" id="strip-view"></span></div>
    </div>
    <div class="reader-scroll" id="scroller"></div>
    <nav class="reader-route" id="route" aria-label="Where you are"></nav>
    <aside class="notes" id="notes" aria-label="Ask, words and notes">
      <div class="panel-head">
        <div class="panel-tabs" role="tablist">
          <button role="tab" data-pane="ask" aria-selected="true">Ask</button>
          <button role="tab" data-pane="words" aria-selected="false">Words</button>
          <button role="tab" data-pane="notes" aria-selected="false">Notes</button>
        </div>
        <button class="button quiet small" id="close-notes" title="Close (n)">Close</button>
      </div>
      <div class="pane pane-ask" data-pane="ask">
        <div class="thread" id="thread">
          <div class="thread-empty">
            <p><strong>Select any text in the paper</strong> to explain, simplify, translate or hear it.</p>
            <p>Or ask anything below. The AI answers with the whole paper in mind.</p>
          </div>
        </div>
        <form id="ask" class="composer">
          <textarea id="question" rows="2" placeholder="Ask anything about this paper…"></textarea>
          <button class="button small">Ask</button>
        </form>
      </div>
      <div class="pane" data-pane="words" hidden><div id="reader-vocab" class="reader-vocab"></div></div>
      <div class="pane" data-pane="notes" hidden><div id="notes-list"></div></div>
    </aside>
    <div class="finish-card sheet" id="finish-card" role="dialog" aria-live="polite" hidden></div>
    <div class="word-card sheet" id="word-card" role="dialog" aria-label="What this word means" hidden></div>
    <div class="sel-bar hl-pop" id="hl-pop" role="toolbar" aria-label="Highlight" hidden>
      <span class="sel-colors">${COLORS.map((c) => `<button data-hl-color="${c}" class="sel-dot" aria-label="${c}" title="${named(c)}"><span class="hl-dot hl-${c}"></span></button>`).join("")}</span>
      <button data-hl-act="note">Note</button>
      <button data-hl-act="remove">Remove</button>
    </div>
    <div class="sel-bar" id="pop" role="toolbar" aria-label="Selected text" hidden>
      <span class="sel-colors" role="group" aria-label="Highlight">${COLORS.map((c, i) =>
        `<button data-sel="highlight" data-color="${c}" class="sel-dot" title="Highlight${i ? "" : " (h)"}" aria-label="Highlight ${c}"><span class="hl-dot hl-${c}"></span></button>`).join("")}</span>
      <button data-sel="note" title="Highlight it and write a note">Note</button>
      <button data-sel="explain" title="Explain it with the whole paper in mind (e)">Explain</button>
      <button data-sel="simplify" title="Rewrite it in simple English">Simplify</button>
      <button data-sel="translate" title="${language ? `Translate into ${esc(language)}` : "Set your language in Settings to translate"}">Translate</button>
      ${canSpeak() ? `<button data-sel="listen" title="Hear it read aloud (l)">Listen</button>` : ""}
      <button data-sel="word" title="Add this word to the paper's vocabulary">Save word</button>
    </div>`;
