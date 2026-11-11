// Figures & tables: cut out of the PDF on the server; the key points link to them.
import { api, esc, loading } from "../core.js";
import { iconButton } from "../icons.js";

// ---------- Figures ----------
// The paper's figures with their captions, cut out of the PDF (the first time takes a few seconds).
export async function renderFigures(box, p) {
  if (!p.has_pdf) {
    box.innerHTML = `<p class="hint">Figures come from the paper's PDF. Upload it to see them here.</p>`;
    return;
  }
  box.innerHTML = loading("Finding the figures and tables in the paper");
  let figs;
  try { figs = await api(`/papers/${p.id}/figures`); } catch (e) { if (box.isConnected) box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  if (!box.isConnected) return; // you went to another tab meanwhile
  if (!figs.length) {
    box.innerHTML = `<p class="hint">No figures or tables were found in this PDF. (They're found by their captions, like "Figure 1:" or "Table 2:".)</p>`;
    return;
  }
  const section = (kind, title) => {
    const items = figs.filter((f) => f.kind === kind);
    return items.length ? `<h2 class="figures-head">${title}</h2><div class="figures">${items.map((f) => `<figure class="figure" data-key="${f.kind}-${f.number}">
      <button class="figure-img ${f.kind}" title="See it larger"><img src="${f.url}" alt="${esc(f.caption)}" loading="lazy"></button>
      <figcaption>${esc(f.caption)} <span class="faint">Page ${f.page}</span></figcaption></figure>`).join("")}</div>` : "";
  };
  box.innerHTML = section("figure", "Figures") + section("table", "Tables")
    + `<p class="hint figures-note">Found by their captions in the PDF; one that couldn't be cut out cleanly is left out.</p>`;
  box.onclick = (e) => {
    const key = e.target.closest(".figure-img") && e.target.closest(".figure").dataset.key;
    const fig = key && figs.find((f) => `${f.kind}-${f.number}` === key);
    if (fig) showFigure(p, fig);
  };
}

// One figure, large, with its caption and a way to open the paper at its page.
export function showFigure(p, f) {
  const view = document.createElement("div");
  view.className = "lightbox";
  view.innerHTML = `<div class="lightbox-inner" role="dialog" aria-label="${esc(f.caption)}">
      ${iconButton("close", "Close (Esc)", { cls: "lightbox-close", attrs: "data-close", size: 18 })}
      <img src="${f.url}" alt="">
      <p class="lightbox-caption">${esc(f.caption)}</p>
      <div class="lightbox-actions"><button class="button" data-open>Open at page ${f.page}</button></div></div>`;
  const close = () => { view.remove(); removeEventListener("keydown", onKey); removeEventListener("hashchange", close); };
  const onKey = (e) => e.key === "Escape" && close();
  view.onclick = (e) => {
    if (e.target === view || e.target.closest("[data-close]")) close();
    if (e.target.closest("[data-open]")) {
      try { sessionStorage.setItem(`papers.page.${p.id}`, f.page); } catch { /* opens at the last place */ }
      close();
      location.hash = `#/papers/${p.id}/read`;
    }
  };
  addEventListener("keydown", onKey);
  addEventListener("hashchange", close); // leaving the page closes it
  document.body.append(view);
}

// "Figure 3" or "Table 2" in a text becomes a link that opens it.
export function linkFigures(html) {
  return html.replace(/\b(Fig(?:ure|\.)?|Table)\s*(\d+)/gi, (all, word, n) =>
    `<button type="button" class="link fig-link" data-kind="${/^t/i.test(word) ? "table" : "figure"}" data-n="${n}">${all}</button>`);
}
