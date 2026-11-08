import { api, app, busy, cite, esc, loading, pct, progressBar, statusTag, toast } from "./core.js";
import { renderPdf } from "./pdfview.js";

const minutes = (text) => Math.max(1, Math.round((text || "").split(/\s+/).length / 230));

// ---------- Overview ----------
export async function paperPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const [p, goals, chain] = await Promise.all([api(`/papers/${id}`), api("/topics"), api(`/papers/${id}/chain`)]);
  if (stale()) return;
  const goal = goals.find((g) => g.id === p.topic_id);
  const readLabel = { new: "Start reading", skimmed: "Start reading", reading: `Continue at ${pct(p.position)}`, read: "Read again" }[p.status];
  const ancestors = chain.path.slice(0, -1);
  const readable = p.text || p.has_pdf;

  app.innerHTML = `<div class="container page">
    <nav class="crumbs">${goal ? `<a href="#/goals">Goals</a><span>/</span><a href="#/goals/${goal.id}">${esc(goal.goal)}</a>` : `<a href="#/">Library</a>`}</nav>
    <header class="paper-header" id="header">
      <h1 class="paper-name paper-h1">${esc(p.title)}</h1>
      ${p.authors || p.year ? `<p class="paper-cite">${esc(p.authors)}${p.year ? ` (${p.year})` : ""}</p>` : ""}
      <div class="actions">
        ${readable ? `<a class="button" href="#/papers/${id}/read">${readLabel}</a>` : ""}
        ${p.quiz?.length ? `<a class="button secondary" href="#/papers/${id}/quiz">${p.understanding == null ? "Take the quiz" : "Retake the quiz"}</a>` : ""}
        <label class="button ${readable ? "quiet" : ""}"><span>${p.has_pdf ? "Replace PDF" : "Upload the PDF"}</span><input type="file" id="pdf" accept="application/pdf,.pdf" hidden></label>
        ${p.url ? `<a class="button quiet" href="${esc(p.url)}" target="_blank" rel="noopener">Source</a>` : ""}
        <button class="button quiet" id="edit">Edit details</button>
      </div>
      ${!readable ? `<p class="hint">The full text wasn't available online. Upload the PDF to read it here.</p>` : ""}
      ${p.has_pdf && !p.text ? `<p class="hint">This PDF has no selectable text, so it's probably a scan. You can read it,
        but skimming, explanations and the quiz need text.</p>` : ""}
    </header>

    <div class="paper-layout">
      <div class="paper-main">
        <section class="sheet pad-lg" id="skim"></section>
        <section class="section">
          <div class="section-bar">
            <h2>References</h2>
            ${p.external_id || p.text ? `<button class="button secondary" id="refs-btn">Show references</button>` : ""}
          </div>
          <div id="refs"><p class="faint">${p.external_id || p.text
            ? "Follow a reference to go deeper. The map remembers which paper led you where."
            : "Upload the PDF to see this paper's references."}</p></div>
        </section>
      </div>

      <aside class="paper-side">
        <div class="sheet facts">
          <div><span>Status</span>${statusTag(p)}</div>
          <div><span>Read</span><span class="fact-bar">${progressBar(p)}<span class="num">${pct(p.progress)}</span></span></div>
          ${p.status === "reading" ? `<div><span>Stopped at</span><span class="num">${pct(p.position)}</span></div>` : ""}
          <div><span>Understood</span><span class="num">${p.understanding == null ? `<span class="faint">Not tested</span>` : pct(p.understanding)}</span></div>
          ${p.text ? `<div><span>Length</span><span>${minutes(p.text)} min</span></div>` : ""}
        </div>
        ${ancestors.length ? `<div class="sheet trail"><h3>Found through</h3>
          ${ancestors.map((a) => `<a href="#/papers/${a.id}">${esc(a.title)}</a>`).join("")}</div>` : ""}
        ${chain.children.length ? `<div class="sheet trail"><h3>Led you to</h3>
          ${chain.children.map((c) => `<a href="#/papers/${c.id}">${esc(c.title)}</a>`).join("")}</div>` : ""}
      </aside>
    </div></div>`;

  renderSkim(p);
  app.querySelector("#edit").onclick = () => editDetails(p, goals);
  app.querySelector("#pdf")?.addEventListener("change", (e) => uploadPdf(id, e.target.files[0]));
  app.querySelector("#refs-btn")?.addEventListener("click", (e) => busy(e.currentTarget, "Loading…", () => loadRefs(p)));
}

function editDetails(p, goals) {
  const header = app.querySelector("#header");
  header.innerHTML = `<form class="sheet form edit-form" id="edit-form">
    <label for="f-title">Title</label><input id="f-title" required value="${esc(p.title)}">
    <label for="f-authors">Authors</label><input id="f-authors" value="${esc(p.authors)}" placeholder="Comma-separated">
    <div class="edit-row">
      <div><label for="f-year">Year</label><input id="f-year" type="number" min="1600" max="2100" value="${p.year ?? ""}"></div>
      <div><label for="f-goal">Goal</label><select id="f-goal"><option value="">No goal</option>
        ${goals.map((g) => `<option value="${g.id}" ${g.id === p.topic_id ? "selected" : ""}>${esc(g.goal)}</option>`).join("")}</select></div>
    </div>
    <div class="form-foot"><button type="button" class="button quiet" id="f-cancel">Cancel</button><button class="button">Save</button></div>
  </form>`;
  header.querySelector("#f-cancel").onclick = () => paperPage(p.id, () => false);
  header.querySelector("#edit-form").onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, "Saving…", async () => {
      const year = header.querySelector("#f-year").value;
      const goal = header.querySelector("#f-goal").value;
      await api(`/papers/${p.id}`, { method: "PATCH", json: {
        title: header.querySelector("#f-title").value,
        authors: header.querySelector("#f-authors").value,
        year: year ? Number(year) : null,
        topic_id: goal ? Number(goal) : null,
      } });
      paperPage(p.id, () => false);
    });
  };
}

async function uploadPdf(id, file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  app.querySelector("#pdf").closest("label").querySelector("span").textContent = "Uploading…";
  try {
    await api(`/papers/${id}/pdf`, { method: "POST", body: form });
    location.hash = `#/papers/${id}/read`;
  } catch (e) { toast(e.message); }
}

function renderSkim(p) {
  const box = app.querySelector("#skim");
  const s = p.skim;
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  if (!s) {
    box.innerHTML = `<h2>Skim before you read</h2>
      <p class="skim-intro">A first pass in the style Andrew Ng recommends: what problem it tackles, what's new,
      how it works, what it shows, where it falls short, and which sections deserve a close read.</p>
      <button class="button" id="skim-btn">Skim this paper</button>`;
  } else {
    box.innerHTML = `<div class="section-bar"><h2>Key points</h2>
        <button class="button quiet" id="skim-btn">Redo</button></div>
      <p class="verdict">${esc(s.verdict)}</p>
      <div class="skim">
        <h3>Problem</h3><p>${esc(s.problem)}</p>
        <h3>Contributions</h3>${list(s.contributions)}
        <h3>Method</h3><p>${esc(s.method)}</p>
        <h3>Results</h3>${list(s.results)}
        <h3>Limitations</h3>${list(s.limitations)}
        <h3>Read closely</h3>${list(s.read_closely)}
      </div>`;
  }
  box.querySelector("#skim-btn").onclick = (e) => busy(e.currentTarget, "Reading the paper…", async () => {
    p.skim = await api(`/papers/${p.id}/skim`, { method: "POST" });
    renderSkim(p);
  });
}

async function loadRefs(p) {
  const box = app.querySelector("#refs");
  let refs;
  try { refs = await api(`/papers/${p.id}/references`); }
  catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  app.querySelector("#refs-btn")?.remove();
  box.innerHTML = refs.length ? `<div class="sheet list">${refs.map((r, i) => `<div class="ref">
      <span><span class="ref-title">${esc(r.title)}</span><span class="result-cite">${cite(r)}</span></span>
      ${r.library_id ? `<a class="button quiet" href="#/papers/${r.library_id}">Open</a>`
        : `<button class="button secondary" data-ref="${i}">Read this</button>`}</div>`).join("")}</div>`
    : `<p class="faint">No references found.</p>`;
  box.onclick = (e) => {
    const b = e.target.closest("[data-ref]");
    if (b) busy(b, "Adding…", async () => {
      const added = await api("/papers", { method: "POST", json: { ...refs[b.dataset.ref], topic_id: p.topic_id, source_paper_id: p.id } });
      location.hash = `#/papers/${added.id}`;
    });
  };
}

// ---------- Reader ----------
export async function readerPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const p = await api(`/papers/${id}`);
  if (stale()) return;
  if (!p.text && !p.has_pdf) { location.replace(`#/papers/${id}`); return; }
  // The original PDF is the default; small screens get the reflowed text when there is some.
  let mode = p.has_pdf && (innerWidth >= 700 || !p.text) ? "pdf" : "text";
  document.body.classList.add("reading");

  app.innerHTML = `
    <div class="reader-bar">
      <div class="reader-bar-inner">
        <a href="#/papers/${id}" class="reader-back" title="Back to paper overview"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(p.title)}</span></a>
        ${p.has_pdf && p.text ? `<div class="segmented small" role="group" aria-label="View">
          <button data-mode="pdf">Original</button><button data-mode="text">Text</button></div>` : ""}
        <span class="reader-pct num" id="pct">${pct(p.progress)} read</span>
        <button class="button secondary small" id="toggle-notes">Explanations</button>
        <button class="button small" id="finish">${p.status === "read" ? "Done" : "Finish"}</button>
      </div>
      <div class="reader-progress"><span id="bar" style="width:${pct(p.position)}"></span></div>
    </div>
    <div class="reader">
      <article id="article">
        <div id="content"></div>
        <div class="article-end">
          <p>That's the end of the paper.</p>
          <button class="button" id="finish-end">I've finished, quiz me</button>
        </div>
      </article>
    </div>
    <aside class="notes" id="notes" aria-label="Explanations">
      <div class="notes-head"><h2>Explanations</h2><button class="button quiet small" id="close-notes">Close</button></div>
      <p class="hint">Select a passage in the paper to have it explained with the whole paper in mind, or paste one here.</p>
      <form id="ask" class="ask">
        <textarea id="passage" rows="4" placeholder="Paste a passage"></textarea>
        <input id="question" placeholder="What's confusing about it? (optional)">
        <button class="button small">Explain</button>
      </form>
      <div id="answers"></div>
    </aside>
    <button class="explain-pop" id="pop" hidden>Explain this</button>`;

  const article = app.querySelector("#article");
  const pop = app.querySelector("#pop");
  const setOpen = (open) => document.body.classList.toggle("notes-open", open);

  const content = app.querySelector("#content");
  const positionNow = () => Math.min(1, Math.max(0, (scrollY - article.offsetTop) / Math.max(1, article.offsetHeight - innerHeight)));
  const scrollToPosition = (position) => window.scrollTo(0, article.offsetTop + position * (article.offsetHeight - innerHeight));
  let closePdf = null;

  const show = async (next) => {
    mode = next;
    closePdf?.();
    closePdf = null;
    app.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    article.className = mode === "pdf" ? "pdf-sheet" : "page-sheet";
    if (mode === "text") {
      content.innerHTML = `<h1 class="paper-name">${esc(p.title)}</h1>
        ${p.authors || p.year ? `<p class="article-cite">${esc(p.authors)}${p.year ? ` (${p.year})` : ""}</p>` : ""}
        <div class="article-body">${p.text.split("\n").map((t) => `<p${t.length < 60 ? ' class="short"' : ""}>${esc(t)}</p>`).join("")}</div>`;
      return;
    }
    content.innerHTML = `<div class="pdf-pages" id="pages">${loading("Opening the PDF")}</div>`;
    try {
      closePdf = await renderPdf(`/api/papers/${id}/file`, content.querySelector("#pages"));
    } catch (e) {
      content.innerHTML = `<p class="error pad">Couldn't open the PDF: ${esc(e.message)}</p>`;
    }
  };

  // Open the paper, then go back to where the reader stopped.
  await show(mode);
  if (stale()) { closePdf?.(); return; }
  if (p.position > 0.01 && p.position < 0.99) {
    scrollToPosition(p.position);
    toast(`Back where you stopped, ${pct(p.position)} in`);
  }

  app.querySelector(".reader-bar .segmented")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || b.dataset.mode === mode) return;
    const position = positionNow();
    await show(b.dataset.mode);
    scrollToPosition(position);
  });

  let timer;
  let progress = p.progress;
  const onScroll = () => {
    const position = positionNow();
    app.querySelector("#bar").style.width = pct(position);
    progress = Math.max(progress, position);
    app.querySelector("#pct").textContent = `${pct(progress)} read`;
    pop.hidden = true;
    clearTimeout(timer);
    timer = setTimeout(() => api(`/papers/${id}/progress`, { method: "PUT", json: { position } }).catch(() => {}), 700);
  };
  addEventListener("scroll", onScroll, { passive: true });

  const explain = async (passage, question = "") => {
    setOpen(true);
    const item = document.createElement("div");
    item.className = "answer";
    item.innerHTML = `<p class="answer-quote">${esc(passage.length > 400 ? passage.slice(0, 400) + "…" : passage)}</p>
      ${question ? `<p class="answer-q">${esc(question)}</p>` : ""}<div class="answer-body">${loading("Explaining")}</div>`;
    app.querySelector("#answers").prepend(item);
    try {
      const r = await api(`/papers/${id}/explain`, { method: "POST", json: { passage, question } });
      item.querySelector(".answer-body").textContent = r.explanation;
    } catch (e) {
      item.querySelector(".answer-body").innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  };

  // Mark explained passages in the reflowed text; the PDF text layer is absolutely positioned, so leave it alone.
  const highlight = (range) => {
    if (mode !== "text") return;
    try {
      const mark = document.createElement("mark");
      mark.className = "explained";
      range.surroundContents(mark);
    } catch { /* selection spans paragraphs; skip the inline highlight */ }
  };

  article.addEventListener("mouseup", () => setTimeout(() => {
    const sel = getSelection();
    const text = sel.toString().trim();
    if (text.length < 3) { pop.hidden = true; return; }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    pop.style.top = `${rect.top + scrollY - 44}px`;
    pop.style.left = `${Math.min(innerWidth - 140, Math.max(8, rect.left + rect.width / 2 - 60))}px`;
    pop.hidden = false;
    pop.onclick = () => { pop.hidden = true; highlight(range.cloneRange()); sel.removeAllRanges(); explain(text); };
  }));

  app.querySelector("#ask").onsubmit = (e) => {
    e.preventDefault();
    const passage = app.querySelector("#passage").value.trim();
    if (!passage) return;
    explain(passage, app.querySelector("#question").value.trim());
    app.querySelector("#passage").value = app.querySelector("#question").value = "";
  };
  app.querySelector("#toggle-notes").onclick = () => setOpen(!document.body.classList.contains("notes-open"));
  app.querySelector("#close-notes").onclick = () => setOpen(false);

  const finish = (e) => busy(e.currentTarget, "Writing your quiz…", async () => {
    await api(`/papers/${id}/finish`, { method: "POST" });
    location.hash = `#/papers/${id}/quiz`;
  });
  app.querySelector("#finish").onclick = p.status === "read" ? () => (location.hash = `#/papers/${id}`) : finish;
  app.querySelector("#finish-end").onclick = finish;

  return () => {
    removeEventListener("scroll", onScroll);
    clearTimeout(timer);
    closePdf?.();
    document.body.classList.remove("notes-open");
  };
}

// ---------- Quiz ----------
export async function quizPage(id, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const p = await api(`/papers/${id}`);
  if (stale()) return;
  const head = `<nav class="crumbs"><a href="#/papers/${id}">${esc(p.title)}</a></nav>
    <div class="page-head"><h1>Check your understanding</h1>
    <p class="lede">Answer in your own words. Answers are graded against the paper, not against exact wording.</p></div>`;

  if (!p.quiz?.length) {
    app.innerHTML = `<div class="container page narrow">${head}
      <div class="empty"><p>No quiz for this paper yet.</p><button class="button" id="gen">Write a quiz</button></div></div>`;
    app.querySelector("#gen").onclick = (e) => busy(e.currentTarget, "Writing questions…", async () => {
      await api(`/papers/${id}/quiz`, { method: "POST" });
      quizPage(id, stale);
    });
    return;
  }

  app.innerHTML = `<div class="container page narrow">${head}
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
      const r = await api(`/papers/${id}/quiz/grade`, { method: "POST", json: { answers } });
      r.results.forEach((res, i) => {
        const level = res.score >= 0.8 ? "good" : res.score >= 0.4 ? "partial" : "miss";
        app.querySelector(`#fb${i}`).innerHTML = `<p class="grade"><span class="score-pill score-${level} num">${pct(res.score)}</span><span>${esc(res.feedback)}</span></p>
          <details><summary>Reference answer</summary><p>${esc(p.quiz[i].answer)}</p></details>`;
      });
      app.querySelector("#score").innerHTML = `You understood <strong class="num">${pct(r.score)}</strong> of this paper`;
    });
  };
}
