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
        <div class="card-actions"><a class="button" href="#/">Back to library</a>
          <button class="button secondary" id="more">More questions</button>
          <a class="button secondary" href="#/papers/${id}">Paper</a></div>
        <p class="card-alt">More questions are about parts of the paper these ones didn't cover.</p>
      </div>`;
      app.querySelector("#more").onclick = (e) => busy(e.currentTarget, "Writing questions…", async () => {
        p.quiz = await moreQuestions(p);
        if (p.quiz.length === ratings.length) return;
        addEventListener("keydown", onKey);
        card();
      });
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

// Asks for more questions; the answer is the paper's whole list, the new ones at the end.
async function moreQuestions(p) {
  const before = p.quiz.length;
  const quiz = await api(`/papers/${p.id}/quiz/more`, { method: "POST" });
  if (quiz.length === before) toast("The AI didn't come up with new questions. Try again.");
  return quiz;
}

function typedQuiz(p, crumbs) {
  const scores = [];  // one per graded question; questions added later are graded on their own
  const question = (q, i) => `<div class="sheet question">
      <label for="a${i}"><span class="q-num">Question ${i + 1}</span>${esc(q.question)}</label>
      <textarea id="a${i}" rows="3"></textarea>
      <div class="feedback" id="fb${i}"></div></div>`;
  app.innerHTML = `<div class="container page narrow">${crumbs}
    <div class="page-head"><h1>Test yourself</h1>
    <p class="lede">Answer in your own words. The AI grades all your answers in one go, against the paper, not against exact wording.</p></div>
    <form id="quiz" class="quiz">${p.quiz.map(question).join("")}
      <div class="quiz-foot"><button class="button" id="grade">Grade my answers</button>
        <button type="button" class="button secondary" id="more" hidden>More questions</button><span id="score" class="score"></span></div>
    </form></div>`;
  const q = (sel) => app.querySelector(sel);

  q("#quiz").onsubmit = (e) => {
    e.preventDefault();
    busy(q("#grade"), "Grading…", async () => {
      const only = p.quiz.map((_, i) => i).filter((i) => scores[i] === undefined);
      const answers = p.quiz.map((_, i) => q(`#a${i}`).value);
      const r = await api(`/papers/${p.id}/quiz/grade`, { method: "POST", json: { answers, only } });
      r.results.forEach((res, k) => {
        const i = r.questions[k];
        scores[i] = res.score;
        const level = res.score >= 0.8 ? "good" : res.score >= 0.4 ? "partial" : "miss";
        q(`#a${i}`).readOnly = true;
        q(`#fb${i}`).innerHTML = `<p class="grade"><span class="score-pill score-${level} num">${pct(res.score)}</span><span>${esc(res.feedback)}</span></p>
          <details><summary>Reference answer</summary><p>${esc(p.quiz[i].answer)}</p></details>`;
      });
      q("#score").innerHTML = `You understood <strong class="num">${pct(scores.reduce((a, b) => a + b, 0) / scores.length)}</strong> of this paper`;
      q("#grade").hidden = true;
      q("#more").hidden = false;
    });
  };

  q("#more").onclick = (e) => busy(e.currentTarget, "Writing questions…", async () => {
    const before = p.quiz.length;
    p.quiz = await moreQuestions(p);
    if (p.quiz.length === before) return;
    q(".quiz-foot").insertAdjacentHTML("beforebegin", p.quiz.slice(before).map((x, k) => question(x, before + k)).join(""));
    q("#grade").hidden = false;
    q("#grade").textContent = "Grade the new answers";
    q("#more").hidden = true;
    q(`#a${before}`).focus();
  });
}
