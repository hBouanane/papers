// A rail beside a scrolling area, in place of its scrollbar: a mark for each part (a guide's sections; in a
// conversation, its questions and the sections of the answers), the part on screen, and the part's name while you
// move. Hover it and every part's name floats out beside its own mark, where it really is in the text, so you see how
// the parts are spread; the one you're in stands out. Click a name or a mark, or anywhere on the rail (and drag).
//   createRail(railEl, scroller, { items: () => [{ el, label, kind?: "question" | "section" }] })
import { esc } from "./core.js";

const GAP = 24; // the least room between two names, in px

export function createRail(rail, scroller, { items }) {
  rail.classList.add("rail");
  rail.innerHTML = `<span class="rail-track"></span><span class="rail-thumb"></span><div class="rail-marks"></div>
    <span class="rail-label" aria-live="polite"></span>
    <div class="rail-float" aria-hidden="true"><svg class="rail-leaders"></svg><div class="rail-tags"></div></div>`;
  const marks = rail.querySelector(".rail-marks"), thumb = rail.querySelector(".rail-thumb");
  const label = rail.querySelector(".rail-label"), tags = rail.querySelector(".rail-tags"), leaders = rail.querySelector(".rail-leaders");
  let parts = [];

  const topOf = (el) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const current = (kind) => {
    let at = -1;
    const line = scroller.scrollTop + scroller.clientHeight / 3;
    parts.forEach((p, i) => { if ((!kind || (p.kind || "section") === kind) && topOf(p.el) < line) at = i; });
    return at;
  };
  const go = (i) => {
    const p = parts[Math.max(0, Math.min(parts.length - 1, i))];
    if (p) scroller.scrollTo({ top: topOf(p.el) - 20, behavior: "smooth" });
  };

  let hideLabel = 0;
  const paint = (moving = false) => {
    const show = parts.length > 0 && scroller.offsetParent !== null && scroller.scrollHeight > scroller.clientHeight + 4;
    rail.hidden = !show;
    if (!show) return;
    const total = Math.max(1, scroller.scrollHeight);
    thumb.style.top = `${(scroller.scrollTop / total) * 100}%`;
    thumb.style.height = `${Math.max(2, (scroller.clientHeight / total) * 100)}%`;
    const at = Math.max(0, current());
    const asked = current("question"); // in a conversation, the question you're under stands out too
    const mark = (el, i) => {
      el.classList.toggle("is-here", i === at || i === asked);
      el.classList.toggle("is-read", i < at);
    };
    marks.querySelectorAll("[data-rail]").forEach((m) => mark(m, Number(m.dataset.rail)));
    tags.querySelectorAll("[data-rail]").forEach((m) => mark(m, Number(m.dataset.rail)));
    label.textContent = parts[at].label;
    label.style.top = thumb.style.top;
    if (moving) {
      rail.classList.add("is-moving");
      clearTimeout(hideLabel);
      hideLabel = setTimeout(() => rail.classList.remove("is-moving"), 1200);
    }
  };

  // Each name sits at its mark; names too close are pushed apart (down, then back up from the bottom), and a thin
  // line leads from each name to its mark.
  const placeTags = () => {
    const H = rail.clientHeight;
    if (!H || !parts.length) return;
    const total = Math.max(1, scroller.scrollHeight);
    const at = parts.map((p) => (topOf(p.el) / total) * H);
    const gap = Math.max(15, Math.min(GAP, H / parts.length));
    const y = [...at];
    for (let i = 1; i < y.length; i++) y[i] = Math.max(y[i], y[i - 1] + gap);
    if (y.at(-1) > H) { y[y.length - 1] = H; for (let i = y.length - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1] - gap); }
    rail.style.setProperty("--tag-size", gap < 20 ? "12px" : "13.5px");
    tags.querySelectorAll("[data-rail]").forEach((t, i) => { t.style.top = `${y[i]}px`; });
    leaders.setAttribute("viewBox", `0 0 24 ${H}`);
    leaders.setAttribute("height", H);
    leaders.innerHTML = at.map((m, i) => `<path d="M0 ${y[i].toFixed(1)} C 12 ${y[i].toFixed(1)}, 10 ${m.toFixed(1)}, 22 ${m.toFixed(1)}" style="--i:${i}"/>`).join("");
  };

  const refresh = () => {
    parts = items().filter((p) => p.el?.isConnected);
    const total = Math.max(1, scroller.scrollHeight);
    marks.innerHTML = parts.map((p, i) => `<button type="button" class="rail-mark is-${p.kind || "section"}" data-rail="${i}"
      style="top:${(topOf(p.el) / total) * 100}%" aria-label="${esc(p.label)}"></button>`).join("");
    tags.innerHTML = parts.map((p, i) => `<button type="button" class="rail-tag is-${p.kind || "section"}" data-rail="${i}" style="--i:${Math.min(i, 30)}"
      tabindex="-1">${esc(p.label)}</button>`).join("");
    placeTags();
    paint();
  };

  // The names come out after a short hover (passing the mouse by doesn't flash them) and stay while you're over them.
  let openTimer = 0, closeTimer = 0;
  // The fade behind the names is the page's own colour (white, grey or dark, whatever is under the rail).
  const backdrop = () => {
    for (let el = scroller; el; el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  // Open, the names close as soon as the pointer is on neither the rail nor a name, the page scrolls under the pointer
  // somewhere else, or Escape is pressed: whatever happens, they never stay in the way.
  const over = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return !!el && (el.closest(".rail-tag") || (rail.contains(el) && !el.closest(".rail-float")));
  };
  const close = () => {
    rail.classList.remove("is-open");
    removeEventListener("pointermove", watch, true);
    removeEventListener("keydown", onEsc, true);
    removeEventListener("wheel", watch, true);
  };
  const watch = (e) => { if (!over(e)) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 120); } else clearTimeout(closeTimer); };
  const onEsc = (e) => { if (e.key === "Escape") close(); };
  const openTags = () => {
    rail.style.setProperty("--rail-bg", backdrop());
    placeTags();
    paint();
    rail.classList.add("is-open");
    addEventListener("pointermove", watch, true);
    addEventListener("wheel", watch, true);
    addEventListener("keydown", onEsc, true);
  };
  rail.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    clearTimeout(closeTimer);
    openTimer = setTimeout(openTags, 150);
  });
  rail.addEventListener("pointerleave", () => {
    clearTimeout(openTimer);
    closeTimer = setTimeout(close, 160);
  });
  rail.addEventListener("pointerover", (e) => { // pointing at a name lights its mark
    const i = e.target.closest?.("[data-rail]")?.dataset.rail;
    marks.querySelectorAll(".rail-mark").forEach((m) => m.classList.toggle("is-pointed", m.dataset.rail === i));
  });
  rail.addEventListener("pointerdown", (e) => {
    const pick = e.target.closest("[data-rail]");
    if (pick) { e.preventDefault(); close(); return go(Number(pick.dataset.rail)); }
    if (e.target.closest(".rail-float")) return;
    const to = (ev) => {
      const b = rail.getBoundingClientRect();
      scroller.scrollTop = ((ev.clientY - b.top) / b.height) * scroller.scrollHeight - scroller.clientHeight / 2;
    };
    e.preventDefault();
    rail.setPointerCapture(e.pointerId);
    to(e);
    rail.onpointermove = to;
    rail.onpointerup = () => { rail.onpointermove = null; };
  });

  const onScroll = () => requestAnimationFrame(() => paint(true));
  scroller.addEventListener("scroll", onScroll, { passive: true });
  const sizes = new ResizeObserver(() => refresh());
  sizes.observe(scroller);
  if (scroller.firstElementChild) sizes.observe(scroller.firstElementChild);

  return {
    refresh,
    paint,
    go,
    step: (d) => go(current() + d),
    observe: (el) => sizes.observe(el),
    destroy() { sizes.disconnect(); scroller.removeEventListener("scroll", onScroll); },
  };
}
