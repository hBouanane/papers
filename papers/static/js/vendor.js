// The libraries the page uses ship with Papers (papers/static/vendor), so everything works without internet:
// reading PDFs, answers with formulas, diagrams, charts and widgets. See vendor/README.md for versions.
export const VENDOR = "/vendor";

// A classic browser build that sets a global (mermaid, vegaEmbed, math): loaded once, in order.
const loaded = new Map();
export function script(path) {
  if (!loaded.has(path)) {
    loaded.set(path, new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src: `${VENDOR}/${path}`, async: false });
      s.onload = resolve;
      s.onerror = () => { loaded.delete(path); reject(new Error(`Couldn't load ${path}`)); };
      document.head.append(s);
    }));
  }
  return loaded.get(path);
}
