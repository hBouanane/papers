// Reading settings for the Text view and the reading voice, remembered in this browser.
import { setSpeechRate, speechRate } from "./speech.js";
import { currentTheme } from "./theme.js";

const KEY = "papers.readingPrefs";
const DEFAULTS = { size: 19, leading: 1.75, font: "paper", width: 680, pages: "auto" };
const SIZES = [16, 17, 18, 19, 20, 22, 24];

export function readingPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}

function save(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* not remembered */ }
}

export function applyReadingPrefs(prefs = readingPrefs()) {
  const s = document.body.style;
  s.setProperty("--read-size", `${prefs.size}px`);
  s.setProperty("--read-leading", prefs.leading);
  s.setProperty("--read-width", `${prefs.width}px`);
  s.setProperty("--read-font", prefs.font === "easy" ? "var(--ui)" : "var(--paper)");
  // PDF pages: white, dimmed or dark. "auto" follows the app (white in light mode, dark in dim and dark mode).
  const tone = pageTone(prefs);
  const dark = tone === "dark";
  const before = document.body.classList.contains("pages-dark");
  document.body.classList.remove("pages-white", "pages-dim", "pages-dark");
  document.body.classList.add(`pages-${tone}`);
  document.querySelectorAll(".page-tone").forEach((group) => {
    group.dataset.at = tone;
    group.querySelectorAll("[data-pages]").forEach((b) => {
      b.classList.toggle("active", b.dataset.pages === tone);
      b.setAttribute("aria-pressed", b.dataset.pages === tone);
    });
  });
  // Dark pages are drawn by the PDF viewer itself, so it has to redraw when they change.
  if (before !== dark || (dark && themeChanged)) document.dispatchEvent(new CustomEvent("dark-pages-changed"));
}

export const pdfPagesDark = () => pageTone(readingPrefs()) === "dark";
const pageTone = (prefs) => ["white", "dim", "dark"].includes(prefs.pages) ? prefs.pages : currentTheme() === "light" ? "white" : "dark";

export function setPageTone(tone) {
  const p = readingPrefs();
  p.pages = tone;
  save(p);
  applyReadingPrefs(p);
}

const ICON = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// White, dimmed or dark PDF pages, in the reader bar (shown in the Original view).
export const pageToneControl = () => `<div class="page-tone" id="page-tone" role="group" aria-label="PDF pages" hidden>
  <span class="page-tone-label">Pages</span>
  <span class="tone-pill"><span class="tone-thumb"></span>
    <button type="button" data-pages="white" title="White pages" aria-label="White pages">${ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}</button>
    <button type="button" data-pages="dim" title="Dimmed pages" aria-label="Dimmed pages">${ICON('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>')}</button>
    <button type="button" data-pages="dark" title="Dark pages (d)" aria-label="Dark pages">${ICON('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>')}</button>
  </span>
</div>`;
let themeChanged = false;
// Picking a theme hands the pages back to it (a Dark pages switch made in the reader was for that moment).
document.addEventListener("theme-changed", () => {
  const p = readingPrefs();
  p.pages = "auto";
  save(p);
  themeChanged = true;
  applyReadingPrefs(p);
  themeChanged = false;
});

// Dark PDF pages on and off (the `d` key in the reader).
export function toggleDarkPages() {
  const p = readingPrefs();
  p.pages = pageTone(p) === "dark" ? "white" : "dark";
  save(p);
  applyReadingPrefs(p);
  return p.pages === "dark";
}

const option = (group, value, label, current) =>
  `<button data-pref="${group}" data-value="${value}" class="${String(current) === String(value) ? "active" : ""}">${label}</button>`;

export const readingPrefsMenu = () => `<details class="menu prefs-menu">
  <summary class="button secondary small" title="Text size, spacing, font and voice speed">Aa</summary>
  <div class="menu-list sheet prefs" id="prefs"></div>
</details>`;

export function bindReadingPrefs(root) {
  const box = root.querySelector("#prefs");
  const draw = () => {
    const p = readingPrefs();
    const rate = speechRate();
    box.innerHTML = `
      <p class="pref-label">Text size <span class="faint">(Text view)</span></p>
      <div class="segmented small"><button data-pref="size" data-value="-">A−</button>
        <span class="pref-value num">${p.size}px</span><button data-pref="size" data-value="+">A+</button></div>
      <p class="pref-label">Line spacing</p>
      <div class="segmented small">${option("leading", 1.55, "Compact", p.leading)}${option("leading", 1.75, "Normal", p.leading)}${option("leading", 2, "Airy", p.leading)}</div>
      <p class="pref-label">Font</p>
      <div class="segmented small">${option("font", "paper", "Like the paper", p.font)}${option("font", "easy", "Easy to read", p.font)}</div>
      <p class="pref-label">Line length</p>
      <div class="segmented small">${option("width", 600, "Short", p.width)}${option("width", 680, "Medium", p.width)}${option("width", 800, "Long", p.width)}</div>
      <p class="pref-label">Reading voice</p>
      <div class="segmented small">${option("rate", 1, "Normal", rate)}${option("rate", 0.8, "Slower", rate)}${option("rate", 0.65, "Slow", rate)}</div>`;
  };
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pref]");
    if (!b) return;
    const p = readingPrefs();
    const { pref, value } = b.dataset;
    if (pref === "rate") setSpeechRate(Number(value));
    else if (pref === "size") {
      const i = SIZES.indexOf(p.size);
      p.size = SIZES[Math.min(SIZES.length - 1, Math.max(0, (i < 0 ? 3 : i) + (value === "+" ? 1 : -1)))];
    } else p[pref] = pref === "font" || pref === "pages" ? value : Number(value);
    save(p);
    applyReadingPrefs(p);
    draw();
  });
  box.closest("details").addEventListener("toggle", draw); // reflect changes made with shortcuts
  draw();
  applyReadingPrefs();
}
