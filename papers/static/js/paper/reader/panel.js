// The side panel: Ask (a conversation with the AI about the paper, answers streamed as they're written),
// Words (the paper's vocabulary) and Notes, one tab at a time.
import { answerView } from "../../chat/answer.js";
import { streamEvents } from "../../chat/stream.js";
import { api, esc, markdown, quote, renderVocab } from "../../core.js";
import { canSpeak, speak, speaking, stopSpeaking } from "../../speech.js";

const ACTION = { explain: "Explain", simplify: "Simplify", translate: "Translate" };

// One turn of the conversation: what you asked (or selected), then the answer.
const turnHtml = (e) => `<div class="msg msg-you">
      ${e.passage ? `<span class="msg-action">${ACTION[e.mode] || "Explain"}</span>${quote(e.passage)}` : ""}
      ${e.question ? `<p>${esc(e.question)}</p>` : ""}</div>
    <div class="msg msg-claude">${e.answer ? markdown(e.answer) : e.error ? `<p class="error">${esc(e.error)}</p>`
      : e.streaming ? "" : `<p class="faint">No answer came back for this one.</p>`}
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
  // The answer appears as it's written (chat/answer.js): placeholder lines and a status line until the first
  // word, the model's thinking folded away, Stop at any time, Retry when it fails. Nothing stays "Thinking".
  const explain = async (passage, question = "", mode = "explain", turn = null) => {
    setOpen(true, "ask");
    if (turn) turn.innerHTML = turnHtml({ passage, question, mode, streaming: true });
    else turn = addTurn({ passage, question, mode, streaming: true });
    const stop = new AbortController();
    const view = answerView(turn.querySelector(".msg-claude"), {
      render: markdown,
      onStop: () => stop.abort(),
      onRetry: () => explain(passage, question, mode, turn),
    });
    const follow = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120; // not if you scrolled up
    turn.addEventListener("answer-grew", () => { if (follow()) toBottom(); });
    try {
      await streamEvents(`/papers/${id}/explain/stream`, { passage, question, mode }, (type, msg) => {
        if (type === "thinking") view.thinking(msg.thinking);
        else if (type === "text") view.text(msg.text);
        else if (type === "status") view.status(msg.status);
      }, { signal: stop.signal });
      view.done();
      if (canSpeak()) turn.querySelector(".msg-claude").insertAdjacentHTML("beforeend", `<button class="link-button msg-listen">Listen</button>`);
    } catch (err) {
      if (stop.signal.aborted) view.stopped();
      else view.error(err.message);
    }
    if (follow()) toBottom();
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
    // A newly made vocabulary, or a word marked as known (or shown again), changes the marks in the page.
    onWordsChanged(refresh) {
      const vocab = $("#reader-vocab");
      vocab.addEventListener("click", () => setTimeout(refresh, 0));
      vocab.addEventListener("known-changed", refresh);
    },
    cleanup() { document.body.classList.remove("notes-open"); },
  };
}
