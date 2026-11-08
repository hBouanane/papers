// Counts a part of the paper as read only when it stayed in view long enough to be read.
// The paper is split into SLICES equal slices; the server keeps which ones were read.
export const SLICES = 100;
const TICK_MS = 500;
const IDLE_MS = 2 * 60 * 1000; // no input for this long: you've walked away
const FAST = 1; // scrolling faster than one screen per second is navigating, not reading
const WPM = 250;
const SHARE_OF_READING_TIME = 0.33; // a quick read still counts; scrolling past doesn't
const MAX_GAP = 3; // unread runs this short between read parts were read too (same rule as the server)

// `scroller` is the element the paper scrolls in.
export function startTracker({ scroller, paper, words, onRead }) {
  const bits = (paper.read_slices || "0".repeat(SLICES))
    .replace(new RegExp(`(?<=1)0{1,${MAX_GAP}}(?=1)`, "g"), (gap) => "1".repeat(gap.length)).split("");
  const dwell = new Array(SLICES).fill(0);
  const needMs = Math.max(1500, ((words / SLICES) / WPM) * 60000 * SHARE_OF_READING_TIME);
  let mode = "read";
  let lastInput = Date.now();
  let lastTop = scroller.scrollTop;
  let lastT = performance.now();
  let position = null; // start of the last slice actually read this session
  const fresh = new Set();

  const touched = () => (lastInput = Date.now());
  const inputs = ["mousemove", "keydown", "wheel", "touchstart"];
  inputs.forEach((e) => addEventListener(e, touched, { passive: true }));
  scroller.addEventListener("scroll", touched, { passive: true });

  const tick = () => {
    const now = performance.now();
    const seconds = (now - lastT) / 1000;
    const screen = scroller.clientHeight;
    const screensPerSecond = Math.abs(scroller.scrollTop - lastTop) / screen / seconds;
    lastT = now;
    lastTop = scroller.scrollTop;
    if (mode !== "read" || document.hidden || Date.now() - lastInput > IDLE_MS || screensPerSecond > FAST) return;
    // Reading happens in the middle of the screen, not at its edges.
    const height = scroller.scrollHeight;
    const first = Math.max(0, Math.floor(((scroller.scrollTop + screen * 0.15) / height) * SLICES));
    const last = Math.min(SLICES - 1, Math.floor(((scroller.scrollTop + screen * 0.85) / height) * SLICES));
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
          fillGapBefore(i);
        }
        onRead();
      }
    }
  };
  // A short unread run just before a newly read slice slipped past the middle of the screen.
  const fillGapBefore = (i) => {
    let j = i - 1;
    while (j >= 0 && bits[j] !== "1" && i - j <= MAX_GAP) j--;
    if (j >= 0 && bits[j] === "1") for (let k = j + 1; k < i; k++) { bits[k] = "1"; fresh.add(k); }
  };
  const timer = setInterval(tick, TICK_MS);

  return {
    bits,
    get mode() { return mode; },
    setMode(next) { mode = next; lastT = performance.now(); lastTop = scroller.scrollTop; },
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
      scroller.removeEventListener("scroll", touched);
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
