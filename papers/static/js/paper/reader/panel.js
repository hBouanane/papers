// The side panel: Ask (a conversation with the AI about the paper, answers streamed as they're written),
// Words (the paper's vocabulary) and Notes, one tab at a time.
import { api, apiStream, esc, markdown, quote, renderVocab } from "../../core.js";
import { canSpeak, speak, speaking, stopSpeaking } from "../../speech.js";

const ACTION = { explain: "Explain", simplify: "Simplify", translate: "Translate" };

// One turn of the conversation: what you asked (or selected), then the answer.
const turnHtml = (e) => `<div class="msg msg-you">
      ${e.passage ? `<span class="msg-action">${ACTION[e.mode] || "Explain"}</span>${quote(e.passage)}` : ""}
      ${e.question ? `<p>${esc(e.question)}</p>` : ""}</div>
    <div class="msg msg-claude">${e.answer ? markdown(e.answer) : e.error ? `<p class="error">${esc(e.error)}</p>` : `<p class="typing">Thinking…</p>`}
      ${e.answer && canSpeak() ? `<button class="link-button msg-listen">Listen</button>` : ""}</div>`;

export function setupPanel(r) {
  const { id, $ } = r;
  const isOpen = () => document.body.classList.contains("notes-open");
  const setOpen = (open, pane) => {
    document.body.classList.toggle("notes-open", open);
    if (!pane) return;
    r.$$(".panel-tabs [data-pane]").forEach((b) => b.setAttribute("aria-selected", b.dataset.pane === pane));
    r.$$(".pane").forEach((el) => (el.hidden = el.dataset.pane !== pane));
    if (pane === "ask") setTimeout(() => $("#thread").scrollTo(0, $("#thread").scrollHeight));
  };

  // ----- Ask -----
  const thread = $("#thread");
  const toBottom = () => (thread.scrollTop = thread.scrollHeight);
  const addTurn = (e) => {
    thread.querySelector(".thread-empty")?.remove();
    const turn = document.createElement("div");
    turn.className = "turn";
    turn.innerHTML = turnHtml(e);
    thread.append(turn);
    toBottom();
    return turn;
  };
  // The answer appears as it's written (redrawn every few dozen milliseconds), with a caret while it's coming.
  const explain = async (passage, question = "", mode = "explain") => {
    setOpen(true, "ask");
    const turn = addTurn({ passage, question, mode });
    const answer = turn.querySelector(".msg-claude");
    let text = "";
    let queued = false;
    const paint = () => {
      queued = false;
      const follow = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; // don't pull you down if you scrolled up
      answer.innerHTML = markdown(text);
      (answer.lastElementChild || answer).insertAdjacentHTML("beforeend", `<span class="caret" aria-hidden="true"></span>`);
      if (follow) toBottom();
    };
    try {
      text = await apiStream(`/papers/${id}/explain/stream`, { passage, question, mode }, (_, sofar) => {
        text = sofar;
        if (!queued) { queued = true; setTimeout(paint, 40); } // at most ~25 redraws a second
      });
      turn.innerHTML = turnHtml({ passage, question, mode, answer: text });
    } catch (err) {
      turn.innerHTML = turnHtml({ passage, question, mode, answer: text, error: text ? "" : err.message });
      if (text) turn.querySelector(".msg-claude").insertAdjacentHTML("beforeend", `<p class="error">${esc(err.message)}</p>`);
    }
    toBottom();
  };
  thread.addEventListener("click", (e) => {
    const listen = e.target.closest(".msg-listen");
    if (listen) speaking() ? stopSpeaking() : speak(listen.closest(".msg").innerText.replace(/Listen$/, ""));
  });
  // Earlier questions for this paper, oldest first, like a conversation.
  api(`/papers/${id}/explanations`).then((items) => {
    items.reverse().forEach((e) => addTurn(e));
  }).catch(() => {});

  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    const question = $("#question").value.trim();
    if (!question) return $("#question").focus();
    explain("", question);
    $("#question").value = "";
  };
  $("#question").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ask").requestSubmit(); }
  });

  // ----- Opening, closing and the tabs -----
  $(".panel-tabs").onclick = (e) => {
    const b = e.target.closest("[data-pane]");
    if (b) setOpen(true, b.dataset.pane);
  };
  const toggle = () => setOpen(!isOpen());
  $("#toggle-notes").onclick = toggle;
  $("#close-notes").onclick = () => setOpen(false);

  // ----- Words -----
  const renderWords = () => renderVocab($("#reader-vocab"), r.paper, { compact: true });

  return {
    setOpen,
    toggle,
    explain,
    renderWords,
    // A newly generated vocabulary or a word marked as known changes the underlines in Text view.
    onWordsChanged(refresh) {
      const vocab = $("#reader-vocab");
      vocab.addEventListener("click", () => setTimeout(() => r.view === "text" && refresh(), 0));
      vocab.addEventListener("known-changed", () => r.view === "text" && refresh());
    },
    cleanup() { document.body.classList.remove("notes-open"); },
  };
}
