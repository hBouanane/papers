// The canvas: a visual from an answer (or a figure the answer cites), opened large over the paper, beside the chat.
// Like Claude's artifacts panel. Escape or the close button puts it away.
import { esc } from "../core.js";
import { iconButton } from "../icons.js";
import { drawOne } from "./render.js";

const TITLE = { chart: "Chart", diagram: "Diagram", math: "Formula", figure: "Figure", widget: "Interactive" };

export function openCanvas(kind, spec, ctx = {}, title = "") {
  document.querySelector(".chat-canvas")?.remove();
  const canvas = document.createElement("section");
  canvas.className = "chat-canvas sheet";
  canvas.setAttribute("role", "dialog");
  canvas.setAttribute("aria-label", title || TITLE[kind] || "Visual");
  canvas.innerHTML = `<header class="canvas-head"><span class="canvas-title">${esc(title || TITLE[kind] || "Visual")}</span>
      ${iconButton("close", "Close (Esc)", { cls: "canvas-close", size: 18 })}</header>
    <div class="canvas-stage"></div>`;
  document.body.append(canvas);
  const close = () => { canvas.remove(); removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  addEventListener("keydown", onKey, true);
  canvas.querySelector(".canvas-close").onclick = close;
  drawOne(canvas.querySelector(".canvas-stage"), kind, typeof spec === "string" ? spec : JSON.stringify(spec), ctx);
  return close;
}
