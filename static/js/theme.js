// Light or dark: follows the system until you pick one with the button in the bar.
const KEY = "papers.theme";
const system = matchMedia("(prefers-color-scheme: dark)");

const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const isDark = () => (stored() || (system.matches ? "dark" : "light")) === "dark";

function apply() {
  const t = stored();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll(".theme-toggle").forEach((b) => {
    b.textContent = isDark() ? "Light" : "Dark";
    b.title = isDark() ? "Switch to light mode" : "Switch to dark mode";
  });
}

export function toggleTheme() {
  try { localStorage.setItem(KEY, isDark() ? "light" : "dark"); } catch { /* not remembered */ }
  apply();
}

export const themeButton = () => `<button type="button" class="theme-toggle"></button>`;

document.addEventListener("click", (e) => { if (e.target.closest?.(".theme-toggle")) toggleTheme(); });
system.addEventListener("change", apply);

apply();
