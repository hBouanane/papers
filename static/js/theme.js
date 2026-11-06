// Light, dim or dark: follows the system (light or dark) until you pick one in the bar.
const KEY = "papers.theme";
export const THEMES = ["light", "dim", "dark"];
const system = matchMedia("(prefers-color-scheme: dark)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const currentTheme = () => (THEMES.includes(stored()) ? stored() : system.matches ? "dark" : "light");

function apply() {
  const t = stored();
  if (THEMES.includes(t)) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const now = currentTheme();
  document.querySelectorAll(".theme-switch").forEach((s) => (s.dataset.at = now));
  document.querySelectorAll("[data-theme-pick]").forEach((b) => {
    b.classList.toggle("active", b.dataset.themePick === now);
    b.setAttribute("aria-pressed", b.dataset.themePick === now);
  });
}

// `from` is the [x, y] point clicked: the new theme grows from there in a circle.
export function setTheme(theme, from) {
  if (theme === currentTheme() && stored()) return;
  const change = () => {
    try { localStorage.setItem(KEY, theme); } catch { /* not remembered */ }
    apply();
  };
  if (!from || !document.startViewTransition || calm.matches) return change();
  const [x, y] = from;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  // The browser runs `change` on its next frame; if no frame comes (a background tab), run it anyway.
  let done = false;
  const once = () => { if (!done) { done = true; change(); } };
  setTimeout(once, 300);
  document.startViewTransition(once).ready.then(() => document.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: 500, easing: "cubic-bezier(.4, 0, .2, 1)", pseudoElement: "::view-transition-new(root)" },
  )).catch(() => {});
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-theme-pick]");
  if (b) setTheme(b.dataset.themePick, [e.clientX, e.clientY]);
});
system.addEventListener("change", apply);
apply();
