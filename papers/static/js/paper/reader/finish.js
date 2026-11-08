// Finishing a paper: asked once you reach the end of the main text (before the references),
// and again at the very end if you said "not yet". "Mark as finished" at the end of the paper does it too.
import { api, busy } from "../../core.js";
import { celebrate } from "../shared.js";

export function setupFinish(r, { flush }) {
  const { id, paper: p, $, scroller } = r;
  const card = $("#finish-card");
  let asked = 0; // 0: not yet asked, 1: asked at the end of the main text, 2: asked at the very end
  const mainEndReached = () => {
    const refs = r.view === "text" && [...scroller.querySelectorAll(".section-head")].find((h) => /references|bibliography/i.test(h.textContent));
    const bottom = scroller.scrollTop + scroller.clientHeight;
    if (refs) return refs.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom - 40;
    return bottom >= scroller.scrollHeight * Math.min(p.main_end, 0.98);
  };
  const atVeryEnd = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40;
  // Only your own scrolling counts, not the jump back to where you stopped.
  let movedByYou = false;
  ["wheel", "touchmove", "keydown", "pointerdown"].forEach((type) =>
    scroller.addEventListener(type, () => (movedByYou = true), { passive: true, once: true }));
  addEventListener("keydown", () => (movedByYou = true), { once: true });
  const checkFinished = () => {
    if (!movedByYou || r.settling || p.status === "read" || !card.hidden) return;
    if ((asked === 0 && mainEndReached()) || (asked === 1 && atVeryEnd())) {
      asked += 1;
      askFinished();
    }
  };
  const askFinished = () => {
    card.innerHTML = `<p class="finish-q">Did you finish reading this paper?</p>
      <div class="finish-actions"><button class="button" data-finish>Yes, I finished</button>
      <button class="button quiet" id="not-yet">Not yet</button></div>`;
    card.hidden = false;
    card.querySelector("#not-yet").onclick = () => (card.hidden = true);
  };
  const finish = (button) => busy(button, "Saving…", async () => {
    flush();
    const done = await api(`/papers/${id}/finish`, { method: "POST" });
    p.status = "read";
    celebrate();
    $("#pct").textContent = "100% read";
    card.innerHTML = `<p class="finish-q">Nice work, that's another paper read.</p>
      <p class="hint">${done.quiz?.length ? "A few review questions are ready whenever you want to check what stuck." : "It's marked as read."}</p>
      <div class="finish-actions">${done.quiz?.length ? `<a class="button" href="#/papers/${id}/quiz">Test yourself</a>` : ""}
      <button class="button quiet" id="keep-reading">Keep reading</button></div>`;
    card.hidden = false;
    card.querySelector("#keep-reading").onclick = () => (card.hidden = true);
    scroller.querySelector(".article-end")?.replaceChildren(Object.assign(document.createElement("p"), { textContent: "You've finished this paper." }));
  });

  scroller.addEventListener("scroll", checkFinished, { passive: true });
  card.addEventListener("click", (e) => { const b = e.target.closest("[data-finish]"); if (b) finish(b); });
  scroller.addEventListener("click", (e) => { const b = e.target.closest("[data-finish]"); if (b) finish(b); });
}
