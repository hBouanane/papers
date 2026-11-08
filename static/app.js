const $ = (sel) => document.querySelector(sel);
const main = $("#main");
const state = { topicId: null, paper: null, tab: "skim" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(`/api${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

// Run an action with its button disabled; report errors as a toast.
async function busy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message); } finally { if (button) button.disabled = false; }
}

function progressBar(p) {
  return `<div class="bar" title="Read ${pct(p.progress)}, stopped at ${pct(p.position)}">
    <span style="width:${pct(p.progress)}"></span><i style="left:${pct(p.position)}"></i></div>`;
}

function stats(p) {
  const understood = p.understanding == null ? "" : ` · understood ${pct(p.understanding)}`;
  return `<span class="badge ${p.status}">${p.status}</span>${progressBar(p)}
    <span class="muted">${pct(p.progress)} read${understood}</span>`;
}

function paperRow(p) {
  return `<div class="card row">
    <div><div class="paper-title" data-open="${p.id}">${esc(p.title)}</div>
      <div class="muted">${esc(p.authors)} ${p.year ?? ""}</div></div>
    <div class="row">${stats(p)}</div></div>`;
}

// ---------- Topics ----------
async function loadTopics() {
  const topics = await api("/topics");
  $("#topics").innerHTML = topics.map((t) =>
    `<li data-topic="${t.id}" class="${t.id === state.topicId ? "active" : ""}">${esc(t.goal)}</li>`).join("");
}

$("#topic-form").onsubmit = (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    const t = await api("/topics", { method: "POST", json: { goal: $("#topic-goal").value } });
    $("#topic-goal").value = "";
    await loadTopics();
    showTopic(t.id);
  });
};

$("#topics").onclick = (e) => { const li = e.target.closest("li"); if (li) showTopic(+li.dataset.topic); };
$("#all-papers").onclick = () => showTopic(null);

async function showTopic(id) {
  state.topicId = id;
  state.paper = null;
  loadTopics();
  const papers = await api(id ? `/papers?topic_id=${id}` : "/papers");
  if (state.topicId !== id || state.paper) return; // user navigated elsewhere meanwhile
  main.innerHTML = `
    <div class="row"><h2>${id ? "Your papers for this goal" : "All papers"}</h2>
      ${id ? `<button id="find">Find papers with AI</button>` : ""}</div>
    <div id="candidates"></div>
    ${papers.map(paperRow).join("") || `<p class="muted">No papers yet.</p>`}`;
  if (id) $("#find").onclick = (e) => busy(e.target, () => findPapers(id));
}

async function findPapers(topicId) {
  const box = $("#candidates");
  box.innerHTML = `<p class="muted">Searching…</p>`;
  let found;
  try { found = await api(`/topics/${topicId}/search`); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<h3>Suggestions</h3>` + found.map((p, i) => `
    <div class="card"><div class="row"><strong>${esc(p.title)}</strong>
      <button class="secondary" data-add="${i}">Add</button></div>
      <div class="muted">${esc(p.authors)} ${p.year ?? ""} ${p.pdf_url ? "· PDF available" : ""}</div>
      <p>${esc(p.abstract).slice(0, 400)}</p></div>`).join("");
  box.onclick = (e) => {
    const b = e.target.closest("[data-add]");
    if (b) busy(b, async () => {
      await api("/papers", { method: "POST", json: { ...found[b.dataset.add], topic_id: topicId } });
      b.textContent = "Added";
      showTopic(topicId);
    });
  };
}

main.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) openPaper(+open.dataset.open);
});

// ---------- Paper view ----------
async function openPaper(id, tab = "skim") {
  state.paper = await api(`/papers/${id}`);
  state.tab = tab;
  renderPaper();
}

function renderPaper() {
  const p = state.paper;
  const tabs = ["skim", "read", "quiz", "references", "chain"];
  main.innerHTML = `
    <button class="link" id="back">← Back</button>
    <h2>${esc(p.title)}</h2>
    <div class="row"><span class="muted">${esc(p.authors)} ${p.year ?? ""}
      ${p.url ? `· <a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ""}</span>
      <div class="row" id="stats">${stats(p)}</div></div>
    <div class="tabs">${tabs.map((t) => `<button data-tab="${t}" class="${t === state.tab ? "active" : ""}">${t}</button>`).join("")}</div>
    <div id="tab"></div>`;
  $("#back").onclick = () => showTopic(state.topicId);
  main.querySelector(".tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { state.tab = b.dataset.tab; renderPaper(); }
  };
  ({ skim: renderSkim, read: renderRead, quiz: renderQuiz, references: renderRefs, chain: renderChain })[state.tab]();
}

function renderSkim() {
  const s = state.paper.skim;
  const list = (items) => `<ul class="plain">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  $("#tab").innerHTML = s ? `
    <div class="card"><h3>Problem</h3><p>${esc(s.problem)}</p>
      <h3>Key contributions</h3>${list(s.contributions)}
      <h3>Method</h3><p>${esc(s.method)}</p>
      <h3>Key results</h3>${list(s.results)}
      <h3>Limitations</h3>${list(s.limitations)}
      <h3>Read closely</h3>${list(s.read_closely)}
      <h3>Verdict</h3><p>${esc(s.verdict)}</p></div>
    <button class="secondary" id="skim">Skim again</button>`
    : `<p class="muted">Get the key points first: problem, contributions, method, results, limitations, and what to read closely.</p>
       <button id="skim">Skim with AI</button>`;
  $("#skim").onclick = (e) => busy(e.target, async () => {
    e.target.textContent = "Skimming…";
    await api(`/papers/${state.paper.id}/skim`, { method: "POST" });
    openPaper(state.paper.id, "skim");
  });
}

function renderRead() {
  const p = state.paper;
  const upload = `<div class="card"><p class="muted">${p.text ? "Replace" : "No full text yet. Upload"} the PDF:</p>
    <input type="file" id="pdf" accept="application/pdf"></div>`;
  if (!p.text) {
    $("#tab").innerHTML = upload;
    return bindUpload();
  }
  $("#tab").innerHTML = `
    <div class="reader">
      <div id="paper-text">${p.text.split("\n").map((t) => `<p>${esc(t)}</p>`).join("")}</div>
      <div class="explain">
        <textarea id="passage" rows="6" placeholder="Select text in the paper or paste a passage you don't understand"></textarea>
        <input id="question" placeholder="Optional: what confuses you?">
        <button id="explain">Explain simply</button>
        <div id="explanation" class="card answer" hidden></div>
        <button class="secondary" id="finish">${p.status === "read" ? "Retake quiz" : "I finished reading"}</button>
        ${upload}
      </div>
    </div>`;
  bindUpload();
  const box = $("#paper-text");
  box.scrollTop = p.position * (box.scrollHeight - box.clientHeight);
  let timer;
  box.onscroll = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const max = box.scrollHeight - box.clientHeight;
      const position = max > 0 ? box.scrollTop / max : 1;
      Object.assign(state.paper, await api(`/papers/${p.id}/progress`, { method: "PUT", json: { position } }));
      const el = $("#stats");
      if (el) el.innerHTML = stats(state.paper);
    }, 600);
  };
  box.onmouseup = () => {
    const sel = window.getSelection().toString().trim();
    if (sel) $("#passage").value = sel;
  };
  $("#explain").onclick = (e) => busy(e.target, async () => {
    const out = $("#explanation");
    out.hidden = false;
    out.textContent = "Thinking…";
    const r = await api(`/papers/${p.id}/explain`, { method: "POST", json: { passage: $("#passage").value, question: $("#question").value } });
    out.textContent = r.explanation;
  });
  $("#finish").onclick = (e) => busy(e.target, async () => {
    e.target.textContent = "Writing your quiz…";
    await api(`/papers/${p.id}/finish`, { method: "POST" });
    openPaper(p.id, "quiz");
  });
}

function bindUpload() {
  $("#pdf").onchange = (e) => busy(null, async () => {
    const form = new FormData();
    form.append("file", e.target.files[0]);
    state.paper = await api(`/papers/${state.paper.id}/pdf`, { method: "POST", body: form });
    renderPaper();
  });
}

function renderQuiz() {
  const quiz = state.paper.quiz;
  if (!quiz || !quiz.length) {
    $("#tab").innerHTML = `<p class="muted">Finish reading the paper to get a quiz.</p><button id="gen">Generate quiz now</button>`;
    $("#gen").onclick = (e) => busy(e.target, async () => {
      await api(`/papers/${state.paper.id}/quiz`, { method: "POST" });
      openPaper(state.paper.id, "quiz");
    });
    return;
  }
  $("#tab").innerHTML = quiz.map((q, i) => `
    <div class="card"><strong>${i + 1}. ${esc(q.question)}</strong>
      <textarea rows="3" data-answer="${i}"></textarea><div id="fb-${i}" class="answer"></div></div>`).join("")
    + `<button id="grade">Check my answers</button> <span id="score"></span>`;
  $("#grade").onclick = (e) => busy(e.target, async () => {
    const answers = [...document.querySelectorAll("[data-answer]")].map((t) => t.value);
    const r = await api(`/papers/${state.paper.id}/quiz/grade`, { method: "POST", json: { answers } });
    r.results.forEach((res, i) => {
      $(`#fb-${i}`).innerHTML = `<p><strong>${pct(res.score)}</strong> — ${esc(res.feedback)}</p>
        <p class="muted">Reference: ${esc(quiz[i].answer)}</p>`;
    });
    $("#score").textContent = `Understanding: ${pct(r.score)}`;
    state.paper.understanding = r.score;
  });
}

async function renderRefs() {
  const p = state.paper;
  $("#tab").innerHTML = `<p class="muted">Loading references…</p>`;
  let refs;
  try { refs = await api(`/papers/${p.id}/references`); } catch (e) { $("#tab").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  $("#tab").innerHTML = refs.map((r, i) => `
    <div class="card row"><div><strong>${esc(r.title)}</strong><div class="muted">${esc(r.authors)} ${r.year ?? ""}</div></div>
      ${r.library_id ? `<button class="secondary" data-open="${r.library_id}">Open</button>` : `<button data-dive="${i}">Dive in</button>`}</div>`).join("")
    || `<p class="muted">No references found.</p>`;
  $("#tab").onclick = (e) => {
    const b = e.target.closest("[data-dive]");
    if (b) busy(b, async () => {
      const added = await api("/papers", { method: "POST", json: { ...refs[b.dataset.dive], topic_id: p.topic_id, source_paper_id: p.id } });
      openPaper(added.id);
    });
  };
}

async function renderChain() {
  const c = await api(`/papers/${state.paper.id}/chain`);
  const link = (x) => `<button class="link" data-open="${x.id}">${esc(x.title)}</button>`;
  $("#tab").innerHTML = `
    <h3>How you got here</h3><div class="chain">${c.path.map(link).join(" → ")}</div>
    <h3>Papers you explored from here</h3>
    ${c.children.map((x) => `<div>${link(x)} <span class="badge ${x.status}">${x.status}</span></div>`).join("") || `<p class="muted">None yet. Use the references tab to dive deeper.</p>`}`;
}

// ---------- Recall ----------
$("#recall-form").onsubmit = (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    const idea = $("#recall-input").value;
    main.innerHTML = `<p class="muted">Searching your library…</p>`;
    const found = await api("/recall", { method: "POST", json: { idea } });
    main.innerHTML = `<h2>Where you read “${esc(idea)}”</h2>` + (found.map((m) => `
      <div class="card"><div class="paper-title" data-open="${m.paper.id}">${esc(m.paper.title)}</div>
        <p>${esc(m.reason)}</p></div>`).join("") || `<p class="muted">No finished paper matches that idea.</p>`);
  });
};

loadTopics();
showTopic(null);
