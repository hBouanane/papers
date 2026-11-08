// The reader bar: the paper starts just below it, and it keeps to one row.
import { setPageTone } from "../../readprefs.js";

// When the bar doesn't fit, the less-used tools move into the ⋯ menu, least used first,
// and come back when there's room again.
const OVERFLOW = ["#page-tone", "#vocab-toggle", "#skim", "#zoom", ".prefs-menu", "#jump"];

export function setupBar(r) {
  const { $ } = r;
  const bar = $("#bar");
  const inner = $(".reader-bar-inner");
  const placeScroller = () => document.body.style.setProperty("--reader-top", `${bar.offsetHeight}px`);
  const barObserver = new ResizeObserver(placeScroller);
  barObserver.observe(bar);
  placeScroller();

  const homes = new Map(); // where each tool sits in the bar, marked by a comment
  const fit = () => {
    const more = $("#bar-more"), list = $("#bar-more-list");
    if (!inner || !more) return;
    OVERFLOW.forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      if (!homes.has(sel)) { const mark = document.createComment(sel); el.before(mark); homes.set(sel, mark); }
      homes.get(sel).after(el);
    });
    more.hidden = true;
    for (const sel of OVERFLOW) {
      if (inner.scrollWidth <= inner.clientWidth) break;
      const el = $(sel);
      if (!el || el.hidden) continue;
      more.hidden = false;
      list.append(el);
    }
    if (!more.querySelector(".bar-more-list > *:not([hidden])")) more.hidden = true;
  };
  const fitObserver = new ResizeObserver(() => fit());
  fitObserver.observe(inner);

  $("#page-tone").onclick = (e) => { const b = e.target.closest("[data-pages]"); if (b) setPageTone(b.dataset.pages); };

  return {
    fit,
    cleanup() {
      barObserver.disconnect();
      fitObserver.disconnect();
      document.body.style.removeProperty("--reader-top");
    },
  };
}
