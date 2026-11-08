// Review: the paper's questions as flashcards (or typed answers), spaced over days.
import { api, app, busy, esc, loading, pct, setBar, toast } from "../core.js";

// ---------- Review (flashcards) ----------
const RATINGS = [[1, "Got it"], [0.5, "Partly"], [0, "Missed it"]];

export async function quizPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const p = await api(`/papers/${id}`);
  if (stale()) return;
  setBar({ back: { href: `#/papers/${id}`, label: p.title }, title: p.title });
  const crumbs = "";

  if (!p.quiz?.length) {
    app.innerHTML = `<div class="container page narrow">${crumbs}
      <div class="page-head"><h1>Test yourself</h1></div>
      <div class="empty"><p>No questions for this paper yet. The AI writes them from the paper.</p>
        <button class="button" id="gen">Write questions</button></div></div>`;
    app.querySelector("#gen").onclick = (e) => busy(e.currentTarget, "Writing questions…", async () => {
      await api(`/papers/${id}/quiz`, { method: "POST" });
      quizPage(id, stale);
    });
    return;
  }

  const ratings = [];
  let revealed = false;
  const card = () => {
    const i = ratings.length;
    if (i === p.quiz.length) return finish();
    const q = p.quiz[i];
    revealed = false;
    app.innerHTML = `<div class="container page narrow">${crumbs}
      <p class="card-count">Card ${i + 1} of ${p.quiz.length}</p>
      <div class="sheet flashcard">
        <p class="card-question">${esc(q.question)}</p>
        <div id="answer" hidden><p class="card-answer">${esc(q.answer)}</p></div>
      </div>
      <div class="card-actions" id="actions">
        <button class="button" id="reveal">Show answer <kbd>Space</kbd></button>
      </div>
      <p class="card-alt">Think of your answer, then reveal it and rate yourself honestly.
        Prefer to write? <button class="link-button" id="typed">Type answers for the AI to grade</button></p>
    </div>`;
    app.querySelector("#reveal").onclick = reveal;
    app.querySelector("#typed").onclick = () => typedQuiz(p, crumbs);
  };
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    app.querySelector("#answer").hidden = false;
    app.querySelector("#actions").innerHTML = RATINGS.map(([value, label], k) =>
      `<button class="button ${k ? "secondary" : ""}" data-rate="${value}">${label} <kbd>${k + 1}</kbd></button>`).join("");
    app.querySelector("#actions").onclick = (e) => {
      const b = e.target.closest("[data-rate]");
      if (b) rate(Number(b.dataset.rate));
    };
  };
  const rate = (value) => { ratings.push(value); card(); };
  const finish = async () => {
    removeEventListener("keydown", onKey);
    app.innerHTML = `<div class="container page narrow">${crumbs}${loading("Saving")}</div>`;
    try {
      const done = await api(`/papers/${id}/review`, { method: "POST", json: { ratings } });
      const days = Math.round((new Date(done.review_due) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
      app.innerHTML = `<div class="container page narrow">${crumbs}
        <div class="sheet flashcard done">
          <p class="card-question">You knew ${ratings.filter((r) => r === 1).length} of ${ratings.length}${ratings.includes(0.5) ? `, partly ${ratings.filter((r) => r === 0.5).length} more` : ""}.</p>
          <p class="card-answer">Next review in ${days} day${days === 1 ? "" : "s"}. The Library will remind you.</p>
        </div>
        <div class="card-actions"><a class="button" href="#/">Back to library</a><a class="button secondary" href="#/papers/${id}">Paper</a></div>
      </div>`;
    } catch (e) { toast(e.message); }
  };
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea")) return;
    if (e.key === " " && !revealed) { e.preventDefault(); reveal(); }
    else if (revealed && ["1", "2", "3"].includes(e.key)) rate(RATINGS[Number(e.key) - 1][0]);
  };
  addEventListener("keydown", onKey);
  card();
  return () => removeEventListener("keydown", onKey);
}

function typedQuiz(p, crumbs) {
  app.innerHTML = `<div class="container page narrow">${crumbs}
    <div class="page-head"><h1>Test yourself</h1>
    <p class="lede">Answer in your own words. The AI grades each answer against the paper, not against exact wording.</p></div>
    <form id="quiz" class="quiz">${p.quiz.map((q, i) => `<div class="sheet question">
      <label for="a${i}"><span class="q-num">Question ${i + 1} of ${p.quiz.length}</span>${esc(q.question)}</label>
      <textarea id="a${i}" rows="3"></textarea>
      <div class="feedback" id="fb${i}"></div></div>`).join("")}
      <div class="quiz-foot"><button class="button">Grade my answers</button><span id="score" class="score"></span></div>
    </form></div>`;

  app.querySelector("#quiz").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Grading…", async () => {
      const answers = p.quiz.map((_, i) => app.querySelector(`#a${i}`).value);
      const r = await api(`/papers/${p.id}/quiz/grade`, { method: "POST", json: { answers } });
      r.results.forEach((res, i) => {
        const level = res.score >= 0.8 ? "good" : res.score >= 0.4 ? "partial" : "miss";
        app.querySelector(`#fb${i}`).innerHTML = `<p class="grade"><span class="score-pill score-${level} num">${pct(res.score)}</span><span>${esc(res.feedback)}</span></p>
          <details><summary>Reference answer</summary><p>${esc(p.quiz[i].answer)}</p></details>`;
      });
      app.querySelector("#score").innerHTML = `You understood <strong class="num">${pct(r.score)}</strong> of this paper`;
    });
  };
}
