// Reading settings for the Text view and the reading voice, remembered in this browser.
import { setSpeechRate, speechRate } from "./speech.js";

const KEY = "papers.readingPrefs";
const DEFAULTS = { size: 19, leading: 1.75, font: "paper", width: 680 };
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
    } else p[pref] = pref === "font" ? value : Number(value);
    save(p);
    applyReadingPrefs(p);
    draw();
  });
  draw();
  applyReadingPrefs();
}
