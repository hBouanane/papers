// A rail beside a scrolling area, in place of its scrollbar: a mark for each part (a guide's sections, a
// conversation's questions), the part on screen, and the part's name while you move. Hover it and every part is
// listed beside it (where you are, what you've passed, how long each one is); click one, or anywhere on the rail
// (and drag), to go there.
//   createRail(railEl, scroller, { items: () => [{ el, label, meta? }], name: "section" })
import { esc } from "./core.js";

export function createRail(rail, scroller, { items, name = "section", title = "" }) {
  rail.classList.add("rail");
  rail.innerHTML = `<span class="rail-track"></span><span class="rail-thumb"></span><div class="rail-marks"></div>
    <span class="rail-label" aria-live="polite"></span>
    <div class="rail-toc" role="navigation" aria-label="${esc(title || `All ${name}s`)}">
      ${title ? `<p class="rail-toc-title">${esc(title)}</p>` : ""}<ol></ol></div>`;
  const marks = rail.querySelector(".rail-marks"), thumb = rail.querySelector(".rail-thumb");
  const label = rail.querySelector(".rail-label"), toc = rail.querySelector(".rail-toc"), list = toc.querySelector("ol");
  let parts = [];

  const topOf = (el) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const current = () => {
    let at = 0;
    const line = scroller.scrollTop + scroller.clientHeight / 3;
    parts.forEach((p, i) => { if (topOf(p.el) < line) at = i; });
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
    const at = current();
    marks.querySelectorAll(".rail-mark").forEach((m, i) => { m.classList.toggle("is-here", i === at); m.classList.toggle("is-read", i < at); });
    list.querySelectorAll("li").forEach((li, i) => { li.classList.toggle("is-here", i === at); li.classList.toggle("is-read", i < at); });
    label.textContent = `${at + 1} / ${parts.length} · ${parts[at].label}`;
    label.style.top = thumb.style.top;
    if (moving) {
      rail.classList.add("is-moving");
      clearTimeout(hideLabel);
      hideLabel = setTimeout(() => rail.classList.remove("is-moving"), 1200);
    }
  };
  const refresh = () => {
    parts = items().filter((p) => p.el?.isConnected);
    const total = Math.max(1, scroller.scrollHeight);
    marks.innerHTML = parts.map((p, i) => `<button type="button" class="rail-mark" data-rail="${i}" style="top:${(topOf(p.el) / total) * 100}%"
      aria-label="${esc(p.label)}"><span>${esc(p.label)}</span></button>`).join("");
    list.innerHTML = parts.map((p, i) => `<li style="--i:${i}"><button type="button" data-rail="${i}"><span class="rail-n">${i + 1}</span>
      <span class="rail-name">${esc(p.label)}</span>${p.meta ? `<span class="rail-meta">${esc(p.meta)}</span>` : ""}</button></li>`).join("");
    paint();
  };

  // The list opens after a short hover (so passing the mouse by doesn't flash it) and stays while you're over it.
  let openTimer = 0, closeTimer = 0;
  rail.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    clearTimeout(closeTimer);
    openTimer = setTimeout(() => {
      rail.classList.add("is-open");
      list.querySelector("li.is-here")?.scrollIntoView({ block: "nearest" });
    }, 160);
  });
  rail.addEventListener("pointerleave", () => {
    clearTimeout(openTimer);
    closeTimer = setTimeout(() => rail.classList.remove("is-open"), 260);
  });
  rail.addEventListener("pointerdown", (e) => {
    const pick = e.target.closest("[data-rail]");
    if (pick) { e.preventDefault(); rail.classList.remove("is-open"); return go(Number(pick.dataset.rail)); }
    if (e.target.closest(".rail-toc")) return;
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
