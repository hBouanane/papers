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
      <p class="card-count"><span>Card ${i + 1} of ${p.quiz.length}</span>
        <span class="bar" aria-hidden="true"><span style="width:${Math.round(i / p.quiz.length * 100)}%"></span></span></p>
      <div class="sheet flashcard">
        <p class="card-question">${esc(q.question)}</p>
        <div id="answer" hidden><p class="card-answer">${esc(q.answer)}</p></div>
      </div>
      <div class="card-actions" id="actions">
        <button class="button" id="reveal">Show answer <kbd>Space</kbd></button>
      </div>
      <p class="card-alt">Think of your answer, then reveal it and rate yourself honestly.</p>
    </div>`;
    app.querySelector("#reveal").onclick = reveal;
  };
  // The first screen: the two ways to test yourself, side by side.
  const choose = () => {
    const n = p.quiz.length;
    app.innerHTML = `<div class="container page narrow">${crumbs}
      <div class="page-head"><h1>Test yourself</h1>
        <p class="lede">${n} question${n === 1 ? "" : "s"} on this paper. Pick how you want to answer.</p></div>
      <div class="review-ways">
        <button type="button" class="sheet review-way" id="way-cards">
          <span class="way-name">Flashcards</span>
          <span class="way-text">Think of the answer, turn the card, and rate yourself. Quick, and needs no AI.</span>
          <span class="way-go">Start <span class="arrow" aria-hidden="true">→</span></span></button>
        <button type="button" class="sheet review-way" id="way-typed">
          <span class="way-name">Written answers</span>
          <span class="way-text">Type each answer in your own words. The AI grades them against the paper and says what you missed.</span>
          <span class="way-go">Start <span class="arrow" aria-hidden="true">→</span></span></button>
      </div>
      ${p.understanding == null ? "" : `<p class="card-alt">Last time you understood ${pct(p.understanding)} of this paper.</p>`}</div>`;
    app.querySelector("#way-cards").onclick = () => { addEventListener("keydown", onKey); card(); };
    app.querySelector("#way-typed").onclick = () => typedQuiz(p, crumbs);
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
  choose();
  return () => removeEventListener("keydown", onKey);
}

// Asks for more questions; the answer is the paper's whole list, the new ones at the end.
async function moreQuestions(p) {
  const before = p.quiz.length;
  const quiz = await api(`/papers/${p.id}/quiz/more`, { method: "POST" });
  if (quiz.length === before) toast("The AI didn't come up with new questions. Try again.");
  return quiz;
}

// Written answers, one question on screen at a time; after grading, every question is shown with its feedback.
function typedQuiz(p, crumbs) {
  const scores = [];  // one per graded question; questions added later are graded on their own
  let at = 0;         // which of the questions still to grade is on screen
  const todo = () => p.quiz.map((_, i) => i).filter((i) => scores[i] === undefined);
  const question = (q, i) => `<div class="sheet question" id="q${i}">
      <label for="a${i}"><span class="q-num">Question ${i + 1}</span>${esc(q.question)}</label>
      <textarea id="a${i}" rows="6"></textarea>
      <div class="feedback" id="fb${i}"></div></div>`;
  app.innerHTML = `<div class="container page narrow">${crumbs}
    <div class="page-head"><h1>Test yourself</h1>
    <p class="lede">Answer in your own words. The AI grades all your answers in one go, against the paper, not against exact wording.</p></div>
    <div class="sheet quiz-result" id="result" hidden></div>
    <p class="card-count" id="where"></p>
    <form id="quiz" class="quiz">${p.quiz.map(question).join("")}
      <div class="quiz-foot"><button type="button" class="button secondary" id="back">Back</button>
        <button type="button" class="button" id="next">Next question</button>
        <button class="button" id="grade">Grade my answers</button>
        <button type="button" class="button secondary" id="more" hidden>More questions</button>
        <button class="link-button" id="grade-now">Grade what I've written so far</button></div>
    </form></div>`;
  const q = (sel) => app.querySelector(sel);

  // Before grading: only the current question. After: all of them, with the score on top.
  const show = (focus = true) => {
    const open = todo();
    at = Math.min(at, Math.max(open.length - 1, 0));
    p.quiz.forEach((_, i) => { q(`#q${i}`).hidden = open.length > 0 && i !== open[at] && scores[i] === undefined; });
    const last = at === open.length - 1;
    const written = open.filter((i) => q(`#a${i}`).value.trim()).length;
    q("#where").hidden = !open.length;
    q("#where").innerHTML = `<span>${at + 1} of ${open.length}${written ? ` · ${written} answered` : ""}</span>
      <span class="bar" aria-hidden="true"><span style="width:${Math.round((at + 1) / (open.length || 1) * 100)}%"></span></span>`;
    q("#back").hidden = !open.length || at === 0;
    q("#next").hidden = !open.length || last;
    q("#grade").hidden = !open.length || !last;
    q("#grade-now").hidden = !open.length || last || !written;
    q("#more").hidden = open.length > 0;
    if (open.length && focus) q(`#a${open[at]}`).focus();
  };
  q("#back").onclick = () => { at -= 1; show(); };
  q("#next").onclick = () => { at += 1; show(); };
  q("#quiz").oninput = () => show(false);
  q("#quiz").onkeydown = (e) => { // Ctrl+Enter: on to the next question, or grade on the last one
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !todo().length) return;
    e.preventDefault();
    (q("#next").hidden ? q("#grade") : q("#next")).click();
  };

  q("#quiz").onsubmit = (e) => {
    e.preventDefault();
    const early = e.submitter === q("#grade-now"); // grade only what is written; the rest stay to answer
    const only = todo().filter((i) => !early || q(`#a${i}`).value.trim());
    if (!only.length) return;
    const grading = early ? q("#grade-now") : q("#grade");
    busy(grading, "Grading…", async () => {
      const answers = p.quiz.map((_, i) => q(`#a${i}`).value);
      const r = await api(`/papers/${p.id}/quiz/grade`, { method: "POST", json: { answers, only } });
      r.results.forEach((res, k) => {
        const i = r.questions[k];
        scores[i] = res.score;
        const level = res.score >= 0.8 ? "good" : res.score >= 0.4 ? "partial" : "miss";
        q(`#a${i}`).readOnly = true;
        q(`#a${i}`).rows = 3;
        q(`#fb${i}`).innerHTML = `<p class="grade"><span class="score-pill score-${level} num">${pct(res.score)}</span><span>${esc(res.feedback)}</span></p>
          <details><summary>Reference answer</summary><p>${esc(p.quiz[i].answer)}</p></details>`;
      });
      q("#result").hidden = false;
      const graded = scores.filter((x) => x !== undefined), left = todo().length;
      const mean = pct(graded.reduce((a, b) => a + b, 0) / graded.length);
      q("#result").innerHTML = left
        ? `<p class="score"><strong class="num">${mean}</strong> on the ${graded.length} answer${graded.length === 1 ? "" : "s"} graded so far</p>
        <p class="hint">${left} question${left === 1 ? "" : "s"} still to answer. What each graded answer missed is below.</p>`
        : `<p class="score">You understood <strong class="num">${mean}</strong> of this paper</p>
        <p class="hint">Each answer and what it missed is below. This score is what the paper's page shows as "Understood".</p>`;
      q("#grade").textContent = "Grade my answers";
      show(false);
      q("#result").scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  q("#more").onclick = (e) => busy(e.currentTarget, "Writing questions…", async () => {
    const before = p.quiz.length;
    p.quiz = await moreQuestions(p);
    if (p.quiz.length === before) return;
    q(".quiz-foot").insertAdjacentHTML("beforebegin", p.quiz.slice(before).map((x, k) => question(x, before + k)).join(""));
    q("#grade").textContent = "Grade the new answers";
    q("#result").hidden = true;
    at = 0;
    show();
  });
  show();
}
