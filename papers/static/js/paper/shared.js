// Small helpers for the paper pages.

// Reading time in minutes, at about 230 words a minute.
export const minutes = (text) => Math.max(1, Math.round((text || "").split(/\s+/).length / 230));

// A short burst of sprinkles when you finish a paper.
export function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#1d3fbb", "#1d7a4e", "#e2b84b", "#b42318", "#8ea6ff"];
  const layer = document.createElement("div");
  layer.className = "sprinkles";
  layer.innerHTML = Array.from({ length: 90 }, () => {
    const x = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const duration = 1.6 + Math.random() * 1.2;
    const drift = (Math.random() - 0.5) * 200;
    const turn = Math.random() * 720 - 360;
    return `<i style="left:${x}vw;background:${colors[Math.floor(Math.random() * colors.length)]};
      animation-delay:${delay}s;animation-duration:${duration}s;--drift:${drift}px;--turn:${turn}deg"></i>`;
  }).join("");
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3500);
}
