// Recall: "which paper had this idea?", searched across everything you've read.
import { api, app, busy, cite, empty, esc, loading } from "../core.js";
import { cover, drawCovers } from "../covers.js";
import { coverFan, paperCard, shorten } from "./shared.js";

// ---------- Recall ----------
// Your papers, big, behind Recall (since that's what it searches): three first pages fanned out like the
// Goals cards. They drift slowly; while a search runs they spread out and glow.
function recallBackdrop(papers) {
  const order = [...papers].sort((a, b) => (b.status === "reading") - (a.status === "reading") || b.has_pdf - a.has_pdf);
  return order.length ? `<div class="recall-backdrop" id="backdrop" aria-hidden="true"><span class="recall-hero">${coverFan(order)}</span></div>` : "";
}

export async function recallPage() {
  app.innerHTML = `<div class="container page narrow recall-page">
    <div class="page-head">
      <h1 class="page-title">Where did I read that?</h1>
      <p class="lede">Describe the idea in your own words. Searches every paper, your notes and the explanations you asked for; finished papers come first.</p>
    </div>
    <form id="recall" class="sheet form">
      <label for="idea" class="visually-hidden">The idea</label>
      <textarea id="idea" rows="3" required placeholder="Adding noise step by step, then learning to undo it"></textarea>
      <div class="form-foot"><button class="button">Search my papers</button></div>
    </form>
    <div id="results"></div>
    <div id="recall-extras" class="recall-extras"></div></div>`;
  const input = app.querySelector("#idea");
  api("/papers").then((papers) => {
    if (!app.querySelector(".recall-page")) return; // left the page meanwhile
    app.insertAdjacentHTML("afterbegin", recallBackdrop(papers));
    drawCovers(app.querySelector("#backdrop"));
    // Ideas from your own papers to try, and the papers searched first (the ones you finished).
    const ideas = papers.filter((p) => p.key_idea && p.status !== "new").slice(0, 5).map((p) => shorten(p.key_idea, 90));
    const finished = papers.filter((p) => p.status === "read");
    app.querySelector("#recall-extras").innerHTML = `
      ${ideas.length ? `<section><h2>Try an idea from your papers</h2>
        <div class="try-ideas">${ideas.map((i) => `<button type="button" class="try-idea">${esc(i)}</button>`).join("")}</div></section>` : ""}
      ${finished.length ? `<section class="page-section"><h2>Searched first</h2>
        <p class="hint">The papers you've finished; then everything else, your notes and the explanations you asked for.</p>
        <div class="shelf goal-shelf">${finished.slice(0, 8).map((p) => paperCard(p)).join("")}</div></section>` : ""}`;
    drawCovers(app.querySelector("#recall-extras"));
    app.querySelector("#recall-extras").onclick = (e) => {
      const idea = e.target.closest(".try-idea");
      if (!idea) return;
      input.value = idea.textContent;
      app.querySelector("#recall").requestSubmit();
    };
  }).catch(() => {});
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); app.querySelector("#recall").requestSubmit(); } };
  app.querySelector("#recall").onsubmit = (e) => {
    e.preventDefault();
    const box = app.querySelector("#results");
    busy(e.submitter, "Searching…", async () => {
      box.innerHTML = loading("Looking through your papers");
      app.querySelector("#backdrop")?.classList.add("searching");
      try {
        const found = await api("/recall", { method: "POST", json: { idea: input.value.trim() } });
        box.innerHTML = found.length ? `<div class="recall-results">${found.map((m) => `
          <a class="match match-card sheet" href="#/papers/${m.paper.id}">
            <span class="match-cover" aria-hidden="true">${cover(m.paper, "small")}</span>
            <span class="match-text"><span class="paper-name">${esc(m.paper.title)}</span>
            <span class="result-cite">${cite(m.paper)}</span>
            <span class="match-reason">${esc(m.reason)}</span></span></a>`).join("")}</div>`
          : empty("Nothing in your library matches that. Try other words for the same idea.");
        drawCovers(box);
      } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      finally { app.querySelector("#backdrop")?.classList.remove("searching"); }
    });
  };
}
