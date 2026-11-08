// Reading progress: what you've actually read (the strip under the bar and the percentage), skimming,
// and saving it to the server as you go.
import { api, pct } from "../../core.js";
import { SLICES, startTracker, stripBackground } from "../../tracker.js";

// The part of the paper on screen, as a box on the strip.
export const paintView = (r) => {
  const { scroller } = r;
  const height = Math.max(1, scroller.scrollHeight);
  const marker = r.$("#strip-view");
  marker.style.left = pct(scroller.scrollTop / height);
  marker.style.width = pct(Math.min(1, scroller.clientHeight / height));
};

export function setupProgress(r) {
  const { id, paper: p, $, scroller } = r;
  const words = p.text ? p.text.split(/\s+/).length : (r.pdf?.pageCount || 10) * 400;
  const tracker = startTracker({ scroller, paper: p, words, onRead: () => paintStrip() });
  // Papers tracked the old way keep their percentage until real reading overtakes it (same rule as the server).
  const legacy = p.read_slices ? 0 : p.progress;
  const paintStrip = () => {
    const read = Math.max(legacy, tracker.bits.filter((b) => b === "1").length / SLICES);
    $("#strip").style.background = stripBackground(tracker.bits);
    $("#pct").textContent = tracker.mode === "skim" ? "Skimming, not counted" : `${pct(read)} read`;
  };
  // Skimming: jump around freely; nothing counts until you switch it off.
  const setSkimming = (on) => {
    flush();
    tracker.setMode(on ? "skim" : "read");
    $("#skim").setAttribute("aria-checked", on);
    document.body.classList.toggle("skimming", on);
    paintStrip();
    if (on && p.status === "new") {
      p.status = "skimmed";
      api(`/papers/${id}/progress`, { method: "PUT", json: { position: r.saved, mode: "skim" } }).catch(() => {});
    }
  };
  const toggleSkimming = () => setSkimming(tracker.mode !== "skim");
  $("#skim").onclick = toggleSkimming;
  paintStrip();
  paintView(r);

  const flush = (keepalive = false) => {
    const update = tracker.take();
    if (!update) return;
    if (update.position !== null) r.saved = update.position;
    const body = JSON.stringify({ position: r.saved, slices: update.slices });
    fetch(`/api/papers/${id}/progress`, { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive }).catch(() => {});
  };
  const flushTimer = setInterval(flush, 4000);
  const onHide = () => flush(true);
  addEventListener("pagehide", onHide);

  scroller.addEventListener("scroll", () => paintView(r), { passive: true });
  $("#strip").onclick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    scroller.scrollTop = ((e.clientX - box.left) / box.width) * scroller.scrollHeight - scroller.clientHeight / 3;
  };

  return {
    flush,
    toggleSkimming,
    cleanup() {
      flush(true);
      tracker.stop();
      clearInterval(flushTimer);
      removeEventListener("pagehide", onHide);
      document.body.classList.remove("skimming");
    },
  };
}
