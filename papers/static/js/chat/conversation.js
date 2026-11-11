// A conversation about a paper, like a chat with Claude: History (every conversation, newest first, renamable),
// passages attached as chips, answers streaming in with Stop and Retry, buttons under each answer (Copy, Simpler,
// Deeper, Save as note, Listen) and suggested follow-ups. Each Explain, Simplify or Translate starts its own
// conversation; you keep asking in it.
//
//   const chat = conversationView(root, { paperId, onSaveNote, toast, visuals: { figures(), onCite(kind, ref) } });
//   chat.start("explain", passage, label)   chat.attach(passage, label)   chat.open(id)   chat.newChat()
import { api, esc, quote } from "../core.js";
import { icon, iconButton } from "../icons.js";
import { canSpeak, speak, speaking, stopSpeaking } from "../speech.js";
import { answerView, checkedLabel } from "./answer.js";
import { openCanvas } from "./canvas.js";
import { drawVisuals, renderAnswer } from "./render.js";
import { streamEvents } from "./stream.js";

const ACTION = { explain: "Explain", simplify: "Simplify", translate: "Translate" };
const LAST = 40; // messages shown when a conversation opens; "Show earlier messages" loads 40 more
const SIMPLER = "Say that again more simply: plain English, short sentences, and an everyday example.";
const DEEPER = "Go deeper: the details, the math step by step, a worked example with numbers, and why it works.";
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(`${iso.replace(" ", "T")}Z`)) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago`
    : s < 7 * 86400 ? `${Math.round(s / 86400)} d ago` : new Date(`${iso.replace(" ", "T")}Z`).toLocaleDateString();
};

export function conversationView(root, { paperId, onSaveNote, onLibraryChanged = () => {}, toast = () => {}, visuals = {} }) {
  const render = renderAnswer;
  // what visuals and citations need: the paper's figures, where a citation goes, and the canvas to open them large
  const ctx = { ...visuals, onOpen: (kind, spec, title) => openCanvas(kind, spec, ctx, title) };
  const draw = (el) => drawVisuals(el, ctx);
  root.classList.add("chat");
  root.innerHTML = `
    <div class="chat-head">
      <button type="button" class="chat-title-btn" aria-expanded="false" title="All conversations about this paper">
        <span class="chat-title">New conversation</span><span class="chat-caret" aria-hidden="true"></span></button>
      ${iconButton("plus", "New conversation", { cls: "chat-new", size: 18 })}
    </div>
    <div class="chat-history" hidden><p class="chat-history-head">Conversations about this paper</p><ul class="chat-history-list"></ul></div>
    <div class="thread" aria-live="polite"></div>
    <form class="composer">
      <div class="composer-box">
        <div class="composer-chips"></div>
        <textarea rows="1" placeholder="Ask about this paper…" aria-label="Your message"></textarea>
        <div class="composer-foot">
          <div class="segmented small depth" role="group" aria-label="How to answer">
            <button type="button" data-depth="quick" title="Answer straight from the paper (fast)">Quick</button>
            <button type="button" data-depth="deep" title="Deep: the AI reads sections, looks at figures and checks your notes before it answers (slower, more thorough)">Deep</button></div>
          <span class="composer-hint">Enter to send</span>
          <button class="composer-send" title="Send (Enter)" aria-label="Send">${icon("send", 18)}</button></div>
      </div>
    </form>`;
  const $ = (s) => root.querySelector(s);
  const thread = $(".thread");
  const box = $("textarea");
  const chipsEl = $(".composer-chips");
  const historyEl = $(".chat-history");

  let current = null; // { id, title, messages }
  let pending = []; // attachments waiting in the composer
  let running = null; // the AbortController of the answer being written
  const DEPTH_KEY = "papers.chatDepth";
  let depth = (() => { try { return localStorage.getItem(DEPTH_KEY) === "deep" ? "deep" : "quick"; } catch { return "quick"; } })();
  const drawDepth = () => root.querySelectorAll("[data-depth]").forEach((b) => b.classList.toggle("active", b.dataset.depth === depth));

  // ---------- Drawing ----------
  const STARTERS = ["What is this paper's main idea?", "Explain the method step by step", "What do the results show?", "What are its limits?"];
  const emptyHtml = `<div class="thread-empty">
      <p><strong>Select text in the paper</strong> to explain, simplify or translate it. Each one starts a conversation you can keep going.</p>
      <p>Or ask anything below; the AI has the whole paper in mind. <strong>Add to chat</strong> on a selection attaches it here.</p>
      <div class="followups">${STARTERS.map((q) => `<button type="button" class="followup" data-followup="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>`;
  const attachmentsHtml = (list) => list.map((a) => `<div class="msg-attachment">${a.label ? `<span class="attachment-label">${esc(a.label)}</span>` : ""}
      ${quote(a.text)}</div>`).join("");
  const userHtml = (m) => `<div class="msg msg-you">
      ${ACTION[m.kind] ? `<span class="msg-action">${ACTION[m.kind]}</span>` : ""}
      ${attachmentsHtml(m.meta?.attachments || [])}
      ${m.content ? `<p>${esc(m.content)}</p>` : ""}</div>`;
  const stepsHtml = (m) => (m.meta?.steps?.length ? `<details class="answer-steps"><summary><span class="steps-label">${checkedLabel(m.meta.steps.length)}</span></summary>
      <ol class="steps-list">${m.meta.steps.map((s) => `<li class="step">${esc(s.summary || s.name)}</li>`).join("")}</ol></details>` : "");
  // What the AI did in Deep mode (notes, highlights, words, papers), each with Undo.
  const actionsListHtml = (m) => (m.meta?.actions?.length ? `<ul class="answer-actions">${m.meta.actions.map((a, i) => `<li class="${a.undone ? "is-undone" : ""}">
      <span class="action-label">${esc(a.label || a.kind)}</span>${a.undone ? `<span class="faint">Undone</span>`
        : `<button type="button" class="link-button" data-undo="${i}">Undo</button>`}</li>`).join("")}</ul>` : "");
  const thinkingHtml = (m) => (m.thinking ? `<details class="answer-thinking"><summary><span class="thinking-label">Thought it through</span></summary>
      <div class="thinking-text">${esc(m.thinking)}</div></details>` : "");
  const actionsHtml = (m, last) => `<div class="msg-actions">
      ${iconButton("copy", "Copy", { attrs: 'data-act="copy"' })}
      ${last ? iconButton("retry", "Try again", { attrs: 'data-act="retry"' }) : ""}
      ${iconButton("note", "Save as a note", { attrs: 'data-act="note"' })}
      ${canSpeak() ? iconButton("listen", "Listen", { attrs: 'data-act="listen"' }) : ""}
      <button type="button" class="msg-chip" data-act="simpler" title="Say it again more simply">Simpler</button>
      <button type="button" class="msg-chip" data-act="deeper" title="Go deeper, with the details (uses Deep mode)">Deeper</button>
      ${m.meta?.model ? `<span class="msg-model" title="The model that wrote this answer">${esc(m.meta.model.model)} · ${esc(m.meta.model.provider)}</span>` : ""}</div>
    ${last && m.meta?.followups?.length ? `<div class="followups">${m.meta.followups.map((q) =>
      `<button type="button" class="followup" data-followup="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}`;
  const assistantHtml = (m, last) => {
    if (m.status === "done") {
      return `<div class="msg msg-claude answer is-done" data-message="${m.id}">${thinkingHtml(m)}${stepsHtml(m)}
        <div class="answer-body">${render(m.content)}</div>${actionsListHtml(m)}</div>${actionsHtml(m, last)}`;
    }
    const problem = m.status === "stopped" ? `<p class="faint">Stopped.</p>` : `<p class="error">${esc(m.meta?.error || "Something went wrong.")}</p>`;
    return `<div class="msg msg-claude answer is-${m.status}" data-message="${m.id}">${thinkingHtml(m)}${stepsHtml(m)}
      <div class="answer-body">${m.content ? render(m.content) : ""}<div class="answer-problem">${problem}
        ${last ? `<button type="button" class="button secondary small" data-act="retry">Retry</button>` : ""}</div></div></div>`;
  };
  const turnEl = (html) => {
    const el = document.createElement("div");
    el.className = "turn";
    el.innerHTML = html;
    thread.append(el);
    return el;
  };
  const drawThread = () => {
    thread.innerHTML = "";
    const ms = current?.messages || [];
    if (!ms.length) { thread.innerHTML = emptyHtml; return; }
    if (current.earlier) {
      thread.insertAdjacentHTML("beforeend", `<div class="show-more"><button type="button" class="button secondary small" data-earlier>Show earlier messages</button>
        <span class="faint">${current.earlier} more</span></div>`);
    }
    ms.forEach((m, i) => turnEl(m.role === "user" ? userHtml(m) : assistantHtml(m, i === ms.length - 1)));
    draw(thread);
    thread.scrollTop = thread.scrollHeight;
  };
  const setTitle = () => { $(".chat-title").textContent = current?.title || "New conversation"; };
  const drawChips = () => {
    chipsEl.innerHTML = pending.map((a, i) => `<span class="chip-attachment" title="${esc(a.text.slice(0, 400))}">
      <span class="chip-attachment-text">${a.label ? `<b>${esc(a.label)}</b> ` : ""}${esc(a.text.slice(0, 70))}${a.text.length > 70 ? "…" : ""}</span>
      <button type="button" data-unchip="${i}" aria-label="Remove" title="Remove">${icon("close", 13)}</button></span>`).join("");
    chipsEl.hidden = !pending.length;
  };
  const grow = () => { box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, 200)}px`; };

  // ---------- History ----------
  let historyShown = 20; // conversations listed; "Show older" adds 20
  const showHistory = async (open = historyEl.hidden) => {
    historyEl.hidden = !open;
    $(".chat-title-btn").setAttribute("aria-expanded", open);
    if (!open) return;
    const list = await api(`/papers/${paperId}/conversations?limit=${historyShown + 1}`).catch(() => []);
    const more = list.length > historyShown;
    $(".chat-history-list").innerHTML = (list.length ? list.slice(0, historyShown).map((c) => `<li class="${c.id === current?.id ? "current" : ""}">
        <button type="button" class="history-open" data-open="${c.id}"><span class="history-title">${esc(c.title || "New conversation")}</span>
          <span class="history-preview">${esc(c.preview || "")}</span><span class="history-time">${ago(c.updated_at)}</span></button>
        <button type="button" class="history-delete" data-delete="${c.id}" title="Delete this conversation" aria-label="Delete">${icon("trash", 15)}</button></li>`).join("")
      : `<li class="history-none">No conversations yet.</li>`)
      + (more ? `<li class="history-more"><button type="button" class="link-button" data-older>Show older</button></li>` : "");
  };

  // ---------- Sending ----------
  const busy = (on) => {
    root.classList.toggle("is-answering", on);
    const b = $(".composer-send");
    b.innerHTML = icon(on ? "stop" : "send", 18);
    b.title = on ? "Stop" : "Send (Enter)";
    b.setAttribute("aria-label", on ? "Stop" : "Send");
  };
  // Stream one answer into a new turn; `request` starts it. Resolves when it's done (or failed or stopped).
  const stream = async (request) => {
    thread.querySelector(".thread-empty")?.remove();
    thread.querySelectorAll(".msg-actions [data-act=retry], .followups").forEach((el) => el.remove()); // only the last answer gets these
    const turn = turnEl(`<div class="msg msg-claude"></div>`);
    const stop = new AbortController();
    running = stop;
    busy(true);
    const view = answerView(turn.querySelector(".msg-claude"), {
      render, onStop: () => stop.abort(), onRetry: () => retry(),
    });
    const follow = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140;
    turn.addEventListener("answer-grew", () => { if (follow()) thread.scrollTop = thread.scrollHeight; });
    thread.scrollTop = thread.scrollHeight;
    try {
      const done = await request(stop.signal, (type, msg) => {
        if (type === "conversation") { current = { id: msg.conversation.id, title: "", messages: [] }; }
        else if (type === "user") { current.messages.push(msg.message); if (!current.title) refreshTitle(); }
        else if (type === "thinking") view.thinking(msg.thinking);
        else if (type === "tool") view.step(msg.tool);
        else if (type === "action") { view.action(msg.action); onLibraryChanged(msg.action.kind); }
        else if (type === "text") view.text(msg.text);
        else if (type === "status") view.status(msg.status);
      });
      current.messages.push(done.message);
      turn.innerHTML = assistantHtml(done.message, true);
      draw(turn);
    } catch (err) {
      if (err.data?.message) current.messages.push(err.data.message);
      if (stop.signal.aborted) view.stopped(); else view.error(err.message);
      if (stop.signal.aborted) loadSoon(); // the server saved what was written; pick it up
    } finally {
      running = null;
      busy(false);
      if (follow()) thread.scrollTop = thread.scrollHeight;
    }
  };
  const loadSoon = () => setTimeout(() => current && open(current.id, { keepScroll: true }), 600);
  const refreshTitle = async () => {
    const c = await api(`/conversations/${current.id}`).catch(() => null);
    if (c) { current.title = c.title; setTitle(); }
  };

  const send = (kind, content, attachments, how = kind === "ask" ? depth : "quick") => {
    if (running) return;
    const message = { kind, content, attachments, depth: how };
    turnEl(userHtml({ kind, content, meta: { attachments } }));
    const path = current ? `/conversations/${current.id}/messages` : `/papers/${paperId}/conversations/start`;
    return stream((signal, on) => streamEvents(path, message, on, { signal }));
  };
  const retry = () => {
    if (running || !current) return;
    while (current.messages.length && current.messages.at(-1).role === "assistant") current.messages.pop();
    thread.lastElementChild?.remove(); // the failed answer
    return stream((signal, on) => streamEvents(`/conversations/${current.id}/retry`, {}, on, { signal }));
  };

  // ---------- Events ----------
  $(".composer").onsubmit = (e) => {
    e.preventDefault();
    if (running) return running.abort();
    const content = box.value.trim();
    if (!content && !pending.length) return box.focus();
    const attachments = pending;
    pending = [];
    drawChips();
    box.value = "";
    grow();
    send("ask", content, attachments);
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(".composer").requestSubmit(); }
  });
  box.addEventListener("input", grow);
  root.querySelector(".depth").addEventListener("click", (e) => {
    const b = e.target.closest("[data-depth]");
    if (!b) return;
    depth = b.dataset.depth;
    try { localStorage.setItem(DEPTH_KEY, depth); } catch { /* not remembered */ }
    drawDepth();
  });
  drawDepth();
  chipsEl.addEventListener("click", (e) => {
    const i = e.target.closest("[data-unchip]")?.dataset.unchip;
    if (i != null) { pending.splice(+i, 1); drawChips(); }
  });
  $(".chat-title-btn").onclick = () => showHistory();
  $(".chat-new").onclick = () => newChat();
  $(".chat-title").addEventListener("dblclick", (e) => { // rename
    if (!current) return;
    e.stopPropagation();
    const input = document.createElement("input");
    input.className = "chat-rename";
    input.value = current.title;
    $(".chat-title-btn").replaceWith(input);
    input.focus();
    input.select();
    const done = async (save) => {
      if (save && input.value.trim() && input.value.trim() !== current.title) {
        current.title = (await api(`/conversations/${current.id}`, { method: "PATCH", json: { title: input.value.trim() } })).title;
      }
      input.replaceWith(root.querySelector(".chat-title-btn") || makeTitleButton());
      setTitle();
    };
    input.addEventListener("keydown", (k) => { if (k.key === "Enter") done(true); if (k.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(true), { once: true });
  });
  let titleButton = $(".chat-title-btn");
  const makeTitleButton = () => titleButton;
  historyEl.addEventListener("click", async (e) => {
    if (e.target.closest("[data-older]")) { historyShown += 20; return showHistory(true); }
    const openId = e.target.closest("[data-open]")?.dataset.open;
    if (openId) { await open(+openId); return showHistory(false); }
    const del = e.target.closest("[data-delete]");
    if (!del) return;
    if (!del.classList.contains("confirm")) { del.classList.add("confirm"); del.textContent = "Delete?"; return; }
    await api(`/conversations/${del.dataset.delete}`, { method: "DELETE" });
    if (current?.id === +del.dataset.delete) newChat();
    showHistory(true);
  });
  thread.addEventListener("click", async (e) => {
    if (e.target.closest("[data-earlier]")) { // the messages before the ones shown, kept in place on screen
      const older = await api(`/conversations/${current.id}?last=${LAST}&before=${current.messages[0].id}`);
      const height = thread.scrollHeight;
      current.messages = [...older.messages, ...current.messages];
      current.earlier = older.earlier;
      drawThread();
      thread.scrollTop = thread.scrollHeight - height;
      return;
    }
    const f = e.target.closest("[data-followup]");
    if (f) return send("ask", f.dataset.followup, []);
    const act = e.target.closest("[data-act]")?.dataset.act;
    const undoAt = e.target.closest("[data-undo]")?.dataset.undo;
    if (!act && undoAt == null) return;
    const msgEl = e.target.closest(".turn")?.querySelector("[data-message]");
    const m = current?.messages.find((x) => String(x.id) === msgEl?.dataset.message);
    if (undoAt != null && m) {
      const fresh = await api(`/messages/${m.id}/undo`, { method: "POST", json: { index: +undoAt } });
      Object.assign(m, fresh);
      e.target.closest(".answer-actions").outerHTML = actionsListHtml(m);
      onLibraryChanged(m.meta.actions[+undoAt].kind);
      return toast("Undone.");
    }
    if (act === "retry") return retry();
    if (act === "simpler") return send("ask", SIMPLER, []);
    if (act === "deeper") return send("ask", DEEPER, [], "deep");
    if (!m) return;
    if (act === "copy") { await navigator.clipboard?.writeText(m.content).catch(() => {}); return toast("Copied."); }
    if (act === "listen") return speaking() ? stopSpeaking() : speak(m.content.replace(/```[\s\S]*?```/g, ""));
    if (act === "note") {
      const asked = current.messages[current.messages.indexOf(m) - 1];
      await onSaveNote?.(m.content, asked?.meta?.attachments?.[0]?.text || "");
    }
  });

  // ---------- Opening ----------
  async function open(id, { keepScroll = false } = {}) {
    const top = thread.scrollTop;
    current = await api(`/conversations/${id}?last=${LAST}`);
    setTitle();
    drawThread();
    if (keepScroll) thread.scrollTop = top;
  }
  function newChat() {
    if (running) running.abort();
    current = null;
    setTitle();
    drawThread();
    showHistory(false);
    box.focus();
  }
  // Open the most recent conversation, if any.
  api(`/papers/${paperId}/conversations`).then((list) => (list[0] ? open(list[0].id) : drawThread())).catch(() => drawThread());
  drawChips();

  return {
    open,
    newChat,
    // Explain, Simplify or Translate a passage: a new conversation that starts with it.
    start(kind, text, label = "") {
      if (running) running.abort();
      current = null;
      setTitle();
      thread.innerHTML = "";
      showHistory(false);
      return send(kind, "", [{ kind: "passage", text, label }]);
    },
    // Attach a passage to the next message.
    attach(text, label = "") {
      pending.push({ kind: "passage", text, label });
      drawChips();
      box.focus();
    },
    focus: () => box.focus(),
  };
}
