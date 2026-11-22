// The in-depth guide: the full lesson on a paper (llm.TASKS["guide"]), read like a short book. A contents list beside
// it follows where you are, a bar shows how far you've read, each section ends with the way to the next one, and
// ← / → (or j / k) move between sections. Formulas, diagrams, charts, widgets and the paper's figures with their boxes
// are drawn as in answers. A new guide is written while you watch: the sections appear as they're written.
//   #/papers/:id/guide/new   write one now
//   #/papers/:id/guide/:mid  read a guide (or any long answer opened here from the chat)
import { api, app, esc, loading, setBar, toast } from "../core.js";
import { streamEvents } from "../chat/stream.js";

const minutesOf = (text) => Math.max(1, Math.round(text.split(/\s+/).length / 220));

export async function guidePage(id, mid, stale) {
  app.innerHTML = `<div class="container page">${loading()}</div>`;
  const writing = Number.isNaN(mid);
  const [p, saved] = await Promise.all([api(`/papers/${id}`), writing ? null : api(`/papers/${id}/messages/${mid}`)]);
  if (stale()) return;
  setBar({ back: { href: `#/papers/${id}`, label: p.title }, title: p.title });
  const { renderAnswer, drawVisuals } = await import("../chat/render.js");
  const ctx = { figures: () => api(`/papers/${id}/figures`).catch(() => []), onCite: () => { location.hash = `#/papers/${id}/read`; } };

  app.innerHTML = `<div class="guide-progress" aria-hidden="true"><span></span></div>
    <div class="container guide-page">
      <aside class="guide-side">
        <p class="guide-kicker">In-depth guide</p>
        <a class="guide-paper paper-name" href="#/papers/${id}">${esc(p.title)}</a>
        <p class="guide-meta hint" id="guide-meta"></p>
        <details class="guide-toc-fold" ${matchMedia("(max-width: 900px)").matches ? "" : "open"}>
          <summary>Contents</summary>
          <nav class="guide-toc" aria-label="Sections"><ol id="toc"></ol></nav></details>
        <div class="guide-side-actions">
          ${p.text || p.has_pdf ? `<a class="button secondary small" href="#/papers/${id}/read">Read the paper</a>` : ""}
          <span class="hint guide-keys">← → between sections</span>
        </div>
      </aside>
      <article class="guide-doc answer" id="doc"></article>
    </div>`;
  const doc = app.querySelector("#doc"), toc = app.querySelector("#toc"), meta = app.querySelector("#guide-meta");
  const bar = app.querySelector(".guide-progress span");

  // Sections: each "##" heading, numbered, with a way on to the next one at its end.
  let heads = [];
  const sectionize = (done) => {
    heads = [...doc.querySelectorAll("h2")];
    heads.forEach((h, i) => {
      h.id = `s${i + 1}`;
      h.dataset.n = i + 1;
    });
    if (done) {
      doc.querySelectorAll(".guide-next").forEach((el) => el.remove());
      heads.forEach((h, i) => {
        const next = heads[i + 1];
        const end = next || null;
        const link = document.createElement("div");
        link.className = "guide-next";
        link.innerHTML = next ? `<button type="button" class="guide-next-btn" data-go="${i + 1}">Next: ${esc(next.textContent)} <span aria-hidden="true">→</span></button>`
          : `<span class="hint">That's the whole guide.</span> <a class="button secondary small" href="#/papers/${id}/read">Read the paper</a>`;
        doc.insertBefore(link, end);
      });
    }
    toc.innerHTML = heads.map((h, i) => `<li><a href="#s${i + 1}" data-go="${i}"><span class="num">${i + 1}</span>${esc(h.textContent)}</a></li>`).join("");
    light();
  };
  const go = (i) => {
    const h = heads[Math.max(0, Math.min(heads.length - 1, i))];
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 72, behavior: "smooth" });
  };
  // Where you are: the last heading above the top third of the screen; and how far through the guide.
  const current = () => {
    let at = 0;
    heads.forEach((h, i) => { if (h.getBoundingClientRect().top < innerHeight / 3) at = i; });
    return at;
  };
  const light = () => {
    const at = current();
    toc.querySelectorAll("a").forEach((a, i) => a.classList.toggle("is-here", i === at));
    const rect = doc.getBoundingClientRect();
    const read = Math.min(1, Math.max(0, (innerHeight - rect.top) / Math.max(1, rect.height)));
    bar.style.width = `${Math.round(read * 100)}%`;
  };
  const onScroll = () => requestAnimationFrame(light);
  addEventListener("scroll", onScroll, { passive: true });
  app.addEventListener("click", (e) => {
    const target = e.target.closest("[data-go]");
    if (!target) return;
    e.preventDefault();
    go(Number(target.dataset.go));
    if (matchMedia("(max-width: 900px)").matches) app.querySelector(".guide-toc-fold").open = false; // out of the way on a phone
  });
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "j") { e.preventDefault(); go(current() + 1); }
    if (e.key === "ArrowLeft" || e.key === "k") { e.preventDefault(); go(current() - 1); }
  };
  addEventListener("keydown", onKey);

  const show = async (text, done) => {
    doc.innerHTML = renderAnswer(text, { streaming: !done });
    // A guide starts at its first section: what comes before it is the model narrating its steps ("I'll look at the
    // figures first") or a title of its own, both noise here.
    const first = doc.querySelector(":scope > h2");
    while (first && doc.firstElementChild && doc.firstElementChild !== first) doc.firstElementChild.remove();
    sectionize(done);
    meta.textContent = `${minutesOf(text)} min read${done ? "" : " · being written…"}`;
    if (done) await drawVisuals(doc, ctx);
  };

  if (!writing) {
    if (saved.status !== "done") {
      doc.innerHTML = `<p class="error">${esc(saved.meta?.error || "This guide wasn't finished.")}</p>
        <a class="button" href="#/papers/${id}/guide/new">Write it again</a>`;
    } else await show(saved.content, true);
    return () => { removeEventListener("scroll", onScroll); removeEventListener("keydown", onKey); };
  }

  // Writing a new one: it streams in, then the address becomes the saved guide's, so a reload keeps it.
  doc.innerHTML = `<div class="guide-writing"><span class="dot-pulse" aria-hidden="true"></span>
    <p>Writing the guide: reading the paper, looking at its figures, working through the method. This takes a few
      minutes; the sections appear here as they're written.</p><p class="hint" id="guide-step"></p></div>`;
  const stop = new AbortController();
  let text = "", last = 0;
  try {
    const done = await streamEvents(`/papers/${id}/conversations/start`,
      { kind: "guide", depth: "deep", content: "Write the in-depth guide to this paper." },
      (type, msg) => {
        if (type === "tool" && msg.tool?.label) {
          const step = app.querySelector("#guide-step");
          if (step) step.textContent = msg.tool.summary || msg.tool.label;
        }
        if (type !== "text") return;
        text += msg.text;
        if (Date.now() - last > 400) { last = Date.now(); show(text, false); }
      }, { signal: stop.signal });
    if (stale()) return;
    history.replaceState(null, "", `#/papers/${id}/guide/${done.message.id}`);
    await show(done.message.content, true);
    toast("The guide is ready. It's kept with the paper.");
  } catch (err) {
    if (stop.signal.aborted || stale()) return;
    doc.insertAdjacentHTML("afterbegin", `<p class="error">${esc(err.message)}</p>`);
  }
  return () => { stop.abort(); removeEventListener("scroll", onScroll); removeEventListener("keydown", onKey); };
}
