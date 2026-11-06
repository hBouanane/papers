// Reading settings for the Text view and the reading voice, remembered in this browser.
import { setSpeechRate, speechRate } from "./speech.js";
import { isDark, toggleTheme } from "./theme.js";

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
  // PDF pages: "auto" follows the theme (white in light mode, dimmed in dark mode).
  const before = document.body.classList.contains("pages-dark");
  document.body.classList.remove("pages-white", "pages-dim", "pages-dark");
  if (prefs.pages !== "auto") document.body.classList.add(`pages-${prefs.pages}`);
  // Dark pages are drawn by the PDF viewer itself, so it has to reopen when that changes.
  if (before !== (prefs.pages === "dark")) document.dispatchEvent(new CustomEvent("dark-pages-changed"));
}

// Dark PDF pages on and off (the `d` key in the reader).
export function toggleDarkPages() {
  const p = readingPrefs();
  p.pages = p.pages === "dark" ? "auto" : "dark";
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
      <p class="pref-label">App</p>
      <div class="segmented small">${option("theme", "light", "Light", isDark() ? "dark" : "light")}${option("theme", "dark", "Dark", isDark() ? "dark" : "light")}</div>
      <p class="pref-label">Text size <span class="faint">(Text view)</span></p>
      <div class="segmented small"><button data-pref="size" data-value="-">A−</button>
        <span class="pref-value num">${p.size}px</span><button data-pref="size" data-value="+">A+</button></div>
      <p class="pref-label">Line spacing</p>
      <div class="segmented small">${option("leading", 1.55, "Compact", p.leading)}${option("leading", 1.75, "Normal", p.leading)}${option("leading", 2, "Airy", p.leading)}</div>
      <p class="pref-label">Font</p>
      <div class="segmented small">${option("font", "paper", "Like the paper", p.font)}${option("font", "easy", "Easy to read", p.font)}</div>
      <p class="pref-label">Line length</p>
      <div class="segmented small">${option("width", 600, "Short", p.width)}${option("width", 680, "Medium", p.width)}${option("width", 800, "Long", p.width)}</div>
      <p class="pref-label">PDF pages <span class="faint">(Original view, <kbd>d</kbd> toggles dark)</span></p>
      <div class="segmented small">${option("pages", "auto", "Auto", p.pages)}${option("pages", "white", "White", p.pages)}${option("pages", "dim", "Dimmed", p.pages)}${option("pages", "dark", "Dark", p.pages)}</div>
      <p class="pref-label">Reading voice</p>
      <div class="segmented small">${option("rate", 1, "Normal", rate)}${option("rate", 0.8, "Slower", rate)}${option("rate", 0.65, "Slow", rate)}</div>`;
  };
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pref]");
    if (!b) return;
    const p = readingPrefs();
    const { pref, value } = b.dataset;
    if (pref === "theme") { if ((value === "dark") !== isDark()) toggleTheme(); draw(); return; }
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
