// The in-depth guide as a third way to read, next to Original and Text: the full lesson on the paper
// (llm.TASKS["guide"]) with the Ask / Words / Notes panel beside it. No contents column: a thin rail on the right
// shows the guide's sections as marks, where you are, and the section's name while you move; click or drag it to go
// anywhere. ← / → move between sections. A new guide is written while you watch.
import { api, esc, toast } from "../../core.js";
import { streamEvents } from "../../chat/stream.js";
import { showFigure } from "../figures.js";

const minutesOf = (text) => Math.max(1, Math.round(text.split(/\s+/).length / 220));

export function setupGuide(r, { cite, toPaper, onShown }) {
  const { id, paper: p, $ } = r;
  const box = $("#guide-scroll"), doc = $("#guide-doc"), head = $("#guide-head"), rail = $("#guide-rail");
  let loaded = null; // the guide shown: { id, content }
  let heads = [];
  let writing = null; // AbortController while one is written
  let render = null;
  const figures = () => api(`/papers/${id}/figures`).catch(() => []);
  const ctx = {
    figures,
    onCite: async (kind, ref, c) => {
      const n = Number((ref.match(/\d+/) || [])[0]);
      if (kind === "figure" || kind === "table") {
        const f = (await figures()).find((x) => x.kind === kind && x.number === n);
        return f ? showFigure(p, f) : toast(`${kind === "table" ? "Table" : "Figure"} ${n} wasn't found in the PDF.`);
      }
      await toPaper();
      cite(kind, ref, c);
    },
  };

  // ----- The rail: sections as marks, where you are, and a label while you move -----
  const current = () => {
    let at = 0;
    const top = box.getBoundingClientRect().top + box.clientHeight / 3;
    heads.forEach((h, i) => { if (h.getBoundingClientRect().top < top) at = i; });
    return at;
  };
  let hideLabel = 0;
  const paintRail = (moving = false) => {
    if (box.hidden || !heads.length) { rail.hidden = true; return; }
    rail.hidden = false;
    const total = Math.max(1, box.scrollHeight);
    const thumb = rail.querySelector(".rail-thumb");
    thumb.style.top = `${(box.scrollTop / total) * 100}%`;
    thumb.style.height = `${Math.max(2, (box.clientHeight / total) * 100)}%`;
    const at = current();
    rail.querySelectorAll(".rail-mark").forEach((m, i) => {
      m.classList.toggle("is-here", i === at);
      m.classList.toggle("is-read", i < at);
    });
    const label = rail.querySelector(".rail-label");
    label.textContent = `${at + 1} / ${heads.length} · ${heads[at].textContent}`;
    label.style.top = thumb.style.top;
    if (moving) {
      rail.classList.add("is-moving");
      clearTimeout(hideLabel);
      hideLabel = setTimeout(() => rail.classList.remove("is-moving"), 1200);
    }
  };
  const placeMarks = () => {
    const total = Math.max(1, box.scrollHeight);
    rail.querySelector(".rail-marks").innerHTML = heads.map((h, i) =>
      `<button class="rail-mark" data-go="${i}" style="top:${(h.offsetTop / total) * 100}%" aria-label="${esc(h.textContent)}"><span>${esc(h.textContent)}</span></button>`).join("");
    paintRail();
  };
  const go = (i) => {
    const h = heads[Math.max(0, Math.min(heads.length - 1, i))];
    if (h) box.scrollTo({ top: h.offsetTop - 24, behavior: "smooth" });
  };
  box.addEventListener("scroll", () => requestAnimationFrame(() => paintRail(true)), { passive: true });
  new ResizeObserver(() => placeMarks()).observe(doc);
  // Click a mark to go to its section, or anywhere on the rail (and drag) to go there.
  rail.addEventListener("pointerdown", (e) => {
    const mark = e.target.closest(".rail-mark");
    if (mark) { e.preventDefault(); return go(Number(mark.dataset.go)); }
    const to = (ev) => {
      const b = rail.getBoundingClientRect();
      box.scrollTop = ((ev.clientY - b.top) / b.height) * box.scrollHeight - box.clientHeight / 2;
    };
    e.preventDefault();
    rail.setPointerCapture(e.pointerId);
    to(e);
    rail.onpointermove = to;
    rail.onpointerup = () => { rail.onpointermove = null; };
  });

  // ----- Showing a guide -----
  const sectionize = () => {
    heads = [...doc.querySelectorAll(":scope > h2")];
    heads.forEach((h, i) => { h.id = `guide-s${i + 1}`; h.dataset.n = i + 1; });
    placeMarks();
  };
  const show = async (text, done) => {
    render ??= await import("../../chat/render.js");
    doc.innerHTML = render.renderAnswer(text, { streaming: !done });
    // A guide starts at its first section: before it there's only the model narrating its steps, or a title.
    const first = doc.querySelector(":scope > h2");
    while (first && doc.firstElementChild !== first) doc.firstElementChild.remove();
    sectionize();
    if (!done) return;
    doc.insertAdjacentHTML("beforeend", `<footer class="guide-end"><p>That's the whole guide.</p>
      <button class="button secondary small" data-guide="paper">Read the paper</button>
      ${p.text ? `<button class="button quiet small" data-guide="new">Write a new guide</button>` : ""}</footer>`);
    await render.drawVisuals(doc, ctx);
    placeMarks();
    onShown?.();
  };
  const header = (text, when) => {
    head.innerHTML = `<p class="guide-kicker">In-depth guide</p><h1 class="guide-title">${esc(p.title)}</h1>
      <p class="guide-meta">${text ? `${minutesOf(text)} min read` : ""}${when ? ` · ${esc(when)}` : ""}</p>`;
  };
  const empty = () => {
    header("", "");
    heads = [];
    doc.innerHTML = p.text ? `<div class="guide-empty">
        <p>The guide teaches the whole paper: the problem, what you need to know first, the key idea, each part of the
          method with formulas and diagrams, the results, and what they do and don't show. It takes a few minutes to write
          and is kept with the paper.</p>
        <button class="button" data-guide="new">Write the guide</button></div>`
      : `<p class="guide-empty">This paper has no text the AI can read, so there's no guide for it.</p>`;
    paintRail();
  };
  const writeNew = async () => {
    if (writing) return;
    header("", "being written…");
    heads = [];
    doc.innerHTML = `<div class="guide-writing"><span class="dot-pulse" aria-hidden="true"></span>
      <p>Writing the guide: reading the paper, looking at its figures, working through the method. This takes a few
        minutes; the sections appear here as they're written. You can keep reading the paper meanwhile.</p>
      <p class="hint" id="guide-step"></p></div>`;
    writing = new AbortController();
    let text = "", last = 0;
    try {
      const done = await streamEvents(`/papers/${id}/conversations/start`,
        { kind: "guide", depth: "deep", content: "Write the in-depth guide to this paper." },
        (type, msg) => {
          if (type === "tool" && msg.tool?.label) {
            const step = doc.querySelector("#guide-step");
            if (step) step.textContent = msg.tool.summary || msg.tool.label;
          }
          if (type !== "text") return;
          text += msg.text;
          if (Date.now() - last > 500 && doc.querySelector(":scope > h2, .guide-writing")) {
            last = Date.now();
            if (/^## /m.test(text)) show(text, false);
          }
        }, { signal: writing.signal });
      loaded = { id: done.message.id, content: done.message.content };
      header(loaded.content, "just written");
      await show(loaded.content, true);
      if (r.guideOn) history.replaceState(history.state, "", `/papers/${id}/guide/${loaded.id}`);
      toast("The guide is ready. It's kept with the paper.");
    } catch (err) {
      if (!writing?.signal.aborted) doc.insertAdjacentHTML("afterbegin", `<p class="error">${esc(err.message)}</p>`);
    } finally { writing = null; }
  };
  const load = async (mid) => {
    if (mid === "new") return writeNew();
    try {
      const guides = mid ? [] : await api(`/papers/${id}/guides`);
      const want = mid || guides[0]?.id;
      if (!want) return empty();
      const m = await api(`/papers/${id}/messages/${want}`);
      if (m.status !== "done") {
        header("", "");
        doc.innerHTML = `<p class="error">${esc(m.meta?.error || "This guide wasn't finished.")}</p>
          <button class="button" data-guide="new">Write it again</button>`;
        return;
      }
      loaded = { id: m.id, content: m.content };
      header(m.content, m.created_at ? `written ${new Date(m.created_at).toLocaleDateString()}` : "");
      await show(m.content, true);
    } catch (e) { doc.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };

  doc.addEventListener("click", (e) => {
    const b = e.target.closest("[data-guide]");
    if (!b) return;
    if (b.dataset.guide === "paper") toPaper();
    if (b.dataset.guide === "new") writeNew();
  });

  return {
    // Open the guide view (a given guide, "new" to write one, or the latest).
    async open(mid = null) {
      r.guideOn = true;
      box.hidden = false;
      $("#scroller").hidden = true;
      document.body.classList.add("guide-view");
      if (!loaded || (mid && mid !== loaded.id)) await load(mid);
      else paintRail();
      if (loaded) history.replaceState(history.state, "", `/papers/${id}/guide/${loaded.id}`);
    },
    close() {
      r.guideOn = false;
      box.hidden = true;
      rail.hidden = true;
      $("#scroller").hidden = false;
      document.body.classList.remove("guide-view");
    },
    sections: () => heads.map((h, i) => ({ label: h.textContent, go: () => go(i) })),
    step: (d) => go(current() + d),
    cleanup() { writing?.abort(); },
  };
}
