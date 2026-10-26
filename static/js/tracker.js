// Counts a part of the paper as read only when it stayed in view long enough to be read.
// The paper is split into SLICES equal slices; the server keeps which ones were read.
export const SLICES = 100;
const TICK_MS = 500;
const IDLE_MS = 2 * 60 * 1000; // no input for this long: you've walked away
const FAST = 1; // scrolling faster than one screen per second is navigating, not reading
const WPM = 250;
const SHARE_OF_READING_TIME = 0.33; // a quick read still counts; scrolling past doesn't

export function startTracker({ article, paper, words, onRead }) {
  const bits = (paper.read_slices || "0".repeat(SLICES)).split("");
  const dwell = new Array(SLICES).fill(0);
  const needMs = Math.max(1500, ((words / SLICES) / WPM) * 60000 * SHARE_OF_READING_TIME);
  let mode = "read";
  let lastInput = Date.now();
  let lastY = scrollY;
  let lastT = performance.now();
  let position = null; // start of the last slice actually read this session
  const fresh = new Set();

  const touched = () => (lastInput = Date.now());
  const inputs = ["scroll", "mousemove", "keydown", "wheel", "touchstart"];
  inputs.forEach((e) => addEventListener(e, touched, { passive: true }));

  const tick = () => {
    const now = performance.now();
    const seconds = (now - lastT) / 1000;
    const screensPerSecond = Math.abs(scrollY - lastY) / innerHeight / seconds;
    lastT = now;
    lastY = scrollY;
    if (mode !== "read" || document.hidden || Date.now() - lastInput > IDLE_MS || screensPerSecond > FAST) return;
    // Reading happens in the middle of the screen, not at its edges.
    const top = article.offsetTop;
    const height = article.offsetHeight;
    const first = Math.max(0, Math.floor(((scrollY + innerHeight * 0.2 - top) / height) * SLICES));
    const last = Math.min(SLICES - 1, Math.floor(((scrollY + innerHeight * 0.8 - top) / height) * SLICES));
    if (last < first) return;
    const share = (seconds * 1000) / (last - first + 1);
    for (let i = first; i <= last; i++) {
      const before = dwell[i];
      dwell[i] += share;
      if (before < needMs && dwell[i] >= needMs) {
        position = i / SLICES;
        if (bits[i] !== "1") {
          bits[i] = "1";
          fresh.add(i);
        }
        onRead();
      }
    }
  };
  const timer = setInterval(tick, TICK_MS);

  return {
    bits,
    get mode() { return mode; },
    setMode(next) { mode = next; lastT = performance.now(); lastY = scrollY; },
    // What to send to the server since the last call (null when nothing changed).
    take() {
      if (position === null && !fresh.size) return null;
      const update = { position, slices: [...fresh] };
      fresh.clear();
      position = null;
      return update;
    },
    stop() {
      clearInterval(timer);
      inputs.forEach((e) => removeEventListener(e, touched));
    },
  };
}

// CSS background showing read slices as filled runs.
export function stripBackground(bits) {
  const stops = [];
  let start = 0;
  for (let i = 1; i <= bits.length; i++) {
    if (i === bits.length || bits[i] !== bits[start]) {
      const color = bits[start] === "1" ? "var(--ink)" : "var(--line)";
      stops.push(`${color} ${(start / bits.length) * 100}% ${(i / bits.length) * 100}%`);
      start = i;
    }
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
