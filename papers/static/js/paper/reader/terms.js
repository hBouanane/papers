// Wraps the paper's hard words (not the ones you know) in an underline that shows their meaning.
import { esc, knownWords } from "../../core.js";

// Returns markTerms(html, seen) for this glossary. `seen` holds the words already underlined in this section,
// so each is marked once per section.
export function termMarker(glossary) {
  const known = knownWords();
  const words = (glossary || []).filter((w) => !known.has(w.term.toLowerCase()));
  const meaning = Object.fromEntries(words.map((w) => [w.term.toLowerCase(), w.meaning]));
  const escaped = words.map((w) => esc(w.term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const pattern = escaped.length ? new RegExp(`\\b(${escaped.join("|")})\\b`, "gi") : null;
  return (html, seen = new Set()) => {
    if (!pattern) return html;
    return html.replace(pattern, (m) => {
      const key = m.toLowerCase();
      if (seen.has(key)) return m;
      seen.add(key);
      return `<abbr class="term" title="${esc(meaning[key] || "")}">${m}</abbr>`;
    });
  };
}
