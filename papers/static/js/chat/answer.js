// One answer while it's being written, and after. Before the first word: grey lines shimmer where the text will go,
// with a status line ("Thinking", "Reading §3.4"), the seconds once it's taking a while, and Stop. A model's
// reasoning streams into a folded "Thinking…" you can open; once it answers it becomes "Thought for 12s".
// Errors and Stop end it with a message and Retry. Never stuck: the server gives up after a silence too.
import { esc } from "../core.js";

export const checkedLabel = (n) => `Checked ${n} thing${n === 1 ? "" : "s"} in the paper`;
const SKELETON = `<div class="answer-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>`;

export function answerView(el, { render, onRetry, onStop } = {}) {
  const started = Date.now();
  let text = "";
  let thinking = "";
  let thoughtFor = 0;
  let status = "Thinking";
  let state = "waiting"; // waiting → writing → done | error | stopped
  let queued = false;
  let ticker = null;

  el.classList.add("answer");
  el.innerHTML = `
    <details class="answer-thinking" hidden><summary><span class="thinking-label">Thinking…</span></summary>
      <div class="thinking-text"></div></details>
    <details class="answer-steps" open hidden><summary><span class="steps-label">Working</span></summary><ol class="steps-list"></ol></details>
    <div class="answer-body">${SKELETON}</div>
    <div class="answer-status" role="status"><span class="status-dot" aria-hidden="true"></span>
      <span class="status-text">Thinking</span><span class="status-time"></span>
      <button type="button" class="link-button answer-stop">Stop</button></div>`;
  const body = el.querySelector(".answer-body");
  const statusRow = el.querySelector(".answer-status");
  const think = el.querySelector(".answer-thinking");
  const stepsEl = el.querySelector(".answer-steps");
  const steps = new Map(); // tool call id → its <li>

  const seconds = () => Math.round((Date.now() - started) / 1000);
  const tick = () => {
    const s = seconds();
    statusRow.querySelector(".status-time").textContent = s >= 5 ? ` · ${s}s` : "";
  };
  ticker = setInterval(tick, 1000);
  el.querySelector(".answer-stop").onclick = () => onStop?.();

  const paint = () => {
    queued = false;
    if (state !== "writing") return;
    body.innerHTML = render ? render(text, { streaming: true }) : esc(text);
    (body.lastElementChild || body).insertAdjacentHTML("beforeend", `<span class="caret" aria-hidden="true"></span>`);
    el.dispatchEvent(new CustomEvent("answer-grew", { bubbles: true }));
  };
  const schedule = () => { if (!queued) { queued = true; setTimeout(paint, 40); } }; // ~25 redraws a second at most

  const finish = (next) => {
    state = next;
    clearInterval(ticker);
    statusRow.hidden = true;
    if (thinking) think.querySelector(".thinking-label").textContent = `Thought for ${thoughtFor || seconds()}s`;
    if (steps.size) { stepsEl.open = false; stepsEl.querySelector(".steps-label").textContent = checkedLabel(steps.size); }
    el.classList.remove("is-waiting", "is-writing");
    el.classList.add(`is-${next}`);
  };
  const retryButton = () => (onRetry ? `<button type="button" class="button secondary small answer-retry">Retry</button>` : "");
  const bindRetry = () => el.querySelector(".answer-retry")?.addEventListener("click", () => onRetry());

  el.classList.add("is-waiting");
  return {
    get text() { return text; },
    status(label) {
      status = label;
      statusRow.querySelector(".status-text").textContent = status;
    },
    // A step of Deep mode: a tool starting ("Reading a section…") or done ("Read §3.5 Positional Encoding").
    step(tool) {
      stepsEl.hidden = false;
      let li = steps.get(tool.id);
      if (!li) {
        li = document.createElement("li");
        li.className = "step is-running";
        stepsEl.querySelector(".steps-list").append(li);
        steps.set(tool.id, li);
      }
      li.textContent = tool.state === "done" ? tool.summary || tool.label : `${tool.label}…`;
      li.classList.toggle("is-running", tool.state !== "done");
      if (tool.state !== "done") this.status(tool.label);
      else if (state === "waiting") this.status("Thinking");
      el.dispatchEvent(new CustomEvent("answer-grew", { bubbles: true }));
    },
    // Something it did to the library while answering (Undo appears once the answer is finished).
    action(a) {
      let list = el.querySelector(".answer-actions");
      if (!list) { list = document.createElement("ul"); list.className = "answer-actions"; el.append(list); }
      list.insertAdjacentHTML("beforeend", `<li><span class="action-label">${esc(a.label || a.kind)}</span></li>`);
    },
    thinking(piece) {
      thinking += piece;
      think.hidden = false;
      think.querySelector(".thinking-text").textContent = thinking;
      if (state === "waiting") this.status("Thinking");
    },
    text(piece) {
      if (state === "waiting") {
        state = "writing";
        thoughtFor = seconds();
        el.classList.replace("is-waiting", "is-writing");
        if (thinking) think.querySelector(".thinking-label").textContent = `Thought for ${thoughtFor}s`;
        this.status("Writing");
      }
      text += piece;
      schedule();
    },
    done() {
      finish("done");
      body.innerHTML = render ? render(text) : esc(text);
      el.dispatchEvent(new CustomEvent("answer-done", { bubbles: true })); // visuals get drawn now
    },
    error(message) {
      const had = text;
      finish("error");
      body.innerHTML = `${had ? (render ? render(had) : esc(had)) : ""}
        <div class="answer-problem"><p class="error">${esc(message)}</p>${retryButton()}</div>`;
      bindRetry();
    },
    stopped() {
      const had = text;
      finish("stopped");
      body.innerHTML = `${had ? (render ? render(had) : esc(had)) : ""}
        <div class="answer-problem"><p class="faint">Stopped.</p>${retryButton()}</div>`;
      bindRetry();
    },
  };
}
