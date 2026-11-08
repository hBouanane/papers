// Pieces several pages share: paper cards (first page + title), the cover fan, small text helpers.
import { empty, esc, pct, progressBar } from "../core.js";
import { cover } from "../covers.js";

export const goalNames = (goals) => Object.fromEntries(goals.map((g) => [g.id, g.goal]));
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const shorten = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

// A paper as its first page (with a sheet tilted behind it), its title and how far you've read.
// Hovering lifts the page, fans the sheet and turns "x% read" into "Continue →".
export const paperCard = (p, note = "") => `<a class="shelf-card" href="#/papers/${p.id}">
    <span class="shelf-stage" aria-hidden="true">${cover(p, "small")}</span>
    <span class="shelf-info">
      <span class="shelf-title paper-name"><span class="ul">${esc(p.title)}</span></span>
      ${note ? `<span class="shelf-note">${note}</span>` : ""}
      <span class="shelf-foot">${progressBar(p)}<span class="foot-swap"><span class="foot-pct num">${p.status === "read" ? "Read" : `${pct(p.progress)} read`}</span>
        <span class="foot-go" aria-hidden="true">${p.status === "new" ? "Open" : "Continue"} <span class="arrow">→</span></span></span></span>
    </span>
  </a>`;

// A paper that isn't in a goal yet. Pointing at it lays frosted glass over its page with "+ Add to a goal"
// (your goals open from it); under the title, how far you've read turns into "Read →" on hover, like the Library.
export const PLUS = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
export const looseCard = (p, goals) => `<div class="shelf-card loose-card" data-paper="${p.id}">
    <div class="loose-stage">
      <span class="shelf-stage" aria-hidden="true">${cover(p, "small")}</span>
      ${goals.length ? `<details class="menu loose-goal"><summary class="glass-add" title="Add to a goal"><span class="glass-plus">${PLUS}</span><span>Add to a goal</span></summary>
        <div class="menu-list sheet" role="menu">${goals.map((g) => `<button role="menuitem" data-goal="${g.id}">${esc(shorten(g.goal, 60))}</button>`).join("")}</div></details>`
        : `<a class="glass-add" href="#/goals" title="Create a goal first"><span class="glass-plus">${PLUS}</span><span>Create a goal</span></a>`}
    </div>
    <a class="loose-title shelf-title paper-name" href="#/papers/${p.id}">${esc(p.title)}</a>
    <a class="shelf-foot loose-foot" href="#/papers/${p.id}${p.has_pdf ? "/read" : ""}">${progressBar(p)}<span class="foot-swap">
      <span class="foot-pct num">${p.status === "read" ? "Read" : p.progress ? `${pct(p.progress)} read` : "Not started"}</span>
      <span class="foot-go" aria-hidden="true">${p.has_pdf ? "Read" : "Open"} <span class="arrow">→</span></span></span></a>
  </div>`;

// Up to three covers fanned out like cards in a hand; they spread a little more on hover.
export const coverFan = (papers) => `<span class="cover-fan" aria-hidden="true">${papers.length
  ? papers.slice(0, 3).map((p) => cover(p, "small")).join("") : `<span class="fan-empty">No papers yet</span>`}</span>`;

// "Good evening, Ada", or just "Good evening" until a name is set in Settings.
export function greeting(name) {
  const h = new Date().getHours();
  const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${esc(name)}` : ""}`;
}
