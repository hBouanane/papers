// What you see before there are any papers: the Library's welcome, and stand-in papers for the other pages'
// backdrops. The stand-ins are drawn, not real: a title, a byline, grey lines for text and a small figure.
import { addFromLink, addPaperControl, app, busy } from "../core.js";

const SAMPLES = [
  { title: "The paper you've been meaning to read", by: "You, and everyone you cite" },
  { title: "The one your advisor keeps mentioning", by: "Someone et al." },
  { title: "The one everybody cites", by: "Many authors" },
];
export const sampleTitle = (i) => SAMPLES[i % SAMPLES.length].title;

const lines = (widths, marked = []) => widths.map((w, i) =>
  `<i style="width:${w}%"${marked.includes(i) ? ' class="sp-hl"' : ""}></i>`).join("");
const FIGURE = `<svg class="sp-fig" viewBox="0 0 100 62" preserveAspectRatio="none">
  <path class="sp-axis" d="M8 4V54H96"/>
  <rect x="16" y="34" width="11" height="20"/><rect x="33" y="24" width="11" height="30"/>
  <rect class="sp-bar-top" x="50" y="11" width="11" height="43"/><rect x="67" y="28" width="11" height="26"/>
  <path class="sp-curve" d="M12 46C30 44 40 16 56 12S82 22 94 18"/></svg>`;

// A stand-in paper the size and shape of a real cover (covers.js), so it fits wherever a cover goes.
// `live` marks the sentences that get highlighted and the part of the figure that gets pointed at.
export function sampleCover(i = 0, size = "small", live = false) {
  const s = SAMPLES[i % SAMPLES.length];
  return `<span class="cover-wrap"><span class="cover-sheet" aria-hidden="true"></span>
    <span class="cover cover-${size} sample-cover${live ? " is-live" : ""}"><span class="sp">
      <span class="sp-title">${s.title}</span><span class="sp-by">${s.by}</span>
      <span class="sp-abs">${lines([100, 96, 100, 62], live ? [1, 2] : [])}</span>
      <span class="sp-cols">
        <span>${lines([100, 94, 100, 88, 100, 97, 70, 100, 92, 100, 58])}</span>
        <span><span class="sp-figbox">${FIGURE}${live ? '<span class="sp-ring"></span>' : ""}</span>${lines([80, 100, 95, 100, 66])}</span>
      </span></span></span></span>`;
}

// Three stand-ins fanned out like the Goals cards' fan (shared.js coverFan).
export const sampleFan = () => `<span class="cover-fan" aria-hidden="true">${[1, 0, 2].map((i) => sampleCover(i)).join("")}</span>`;

// The same fan, big, behind a page that has nothing of yours to show yet (Recall's backdrop, with stand-ins).
export const sampleBackdrop = () => `<div class="recall-backdrop sample-backdrop" aria-hidden="true"><span class="recall-hero">${sampleFan()}</span></div>`;

// "Add your first paper", for the pages that need papers before they can do anything.
export const firstPaper = (title, text) => `<div class="sheet first-paper">
    <div><h2>${title}</h2><p class="hint">${text}</p></div>
    <a class="button" href="#/">Add your first paper</a></div>`;

const STEPS = [
  ["Add a paper or set a goal", "Paste an arXiv link or a DOI, or drop a PDF. Or say what you want to understand, and Papers finds the papers for you."],
  ["Read it with help", "Select a sentence or point at a figure and ask. Your highlights and notes stay with the paper."],
  ["Keep what you read", "Answer questions written from the paper. Reviews come back over days, so it stays."],
];
const SAMPLE_LINK = "arxiv.org/abs/1706.03762";

// The Library with no papers: what the app is for, a paper being read (highlighted, asked about, scored),
// and the two ways to start.
export function welcome(settings) {
  return `<div class="container page welcome">
    <div class="welcome-hero">
      <div class="welcome-text">
        <p class="welcome-kicker">Welcome to Papers</p>
        <h1 class="page-title">Read papers.<br>Understand them.<br><em>Remember them.</em></h1>
        <p class="lede">Say what you want to understand and Papers finds the papers for you. Read them with an AI that knows the whole paper, then check what stayed with you.</p>
        <div class="welcome-actions">${addPaperControl()}<a class="button secondary" href="#/goals">Find papers for a goal</a></div>
        <p class="hint welcome-try">No paper at hand? <button type="button" class="link-button" id="try-sample">Try it with "Attention Is All You Need"</button></p>
        <p class="hint" id="welcome-status" role="status"></p>
      </div>
      <div class="welcome-stage" aria-hidden="true">
        <span class="ws-paper ws-back ws-back-1">${sampleCover(2, "large")}</span>
        <span class="ws-paper ws-back ws-back-2">${sampleCover(1, "large")}</span>
        <span class="ws-paper ws-front">${sampleCover(0, "large", true)}</span>
        <span class="ws-bubble ws-ask">What does this sentence mean?</span>
        <span class="ws-bubble ws-answer"><strong>In plain words</strong>Here is the idea, and the figure that shows it.</span>
        <span class="ws-bubble ws-score"><span>Understood</span><strong class="num">82%</strong><span class="bar"><span></span></span></span>
      </div>
    </div>
    <ol class="welcome-steps">${STEPS.map(([name, text], i) => `<li class="sheet" style="--i:${i}">
      <span class="step-n num" aria-hidden="true">${i + 1}</span><h2>${name}</h2><p class="hint">${text}</p></li>`).join("")}</ol>
    ${settings.ai_ready ? "" : `<div class="sheet first-paper welcome-ai">
      <div><h2>Connect an AI model</h2><p class="hint">Explanations, chat and questions need one: a Claude or ChatGPT subscription, an API key, or a free model on this computer. Reading, highlights and notes work without it.</p></div>
      <a class="button secondary" href="#/settings">Set it up</a></div>`}
  </div>`;
}

// Pair with welcome(): the sample paper link.
export function bindWelcome() {
  const status = app.querySelector("#welcome-status");
  app.querySelector("#try-sample").onclick = (e) => busy(e.currentTarget, "Adding…", async () => {
    status.classList.remove("error");
    status.textContent = "Finding the paper and downloading its PDF…";
    try { location.hash = `#/papers/${(await addFromLink(SAMPLE_LINK)).id}`; }
    catch (err) { status.textContent = err.message; status.classList.add("error"); }
  });
}
