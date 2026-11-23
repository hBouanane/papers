# Bundled libraries

The page's libraries ship with Papers instead of loading from a CDN. That way the app works without internet
(reading PDFs, answers with formulas, diagrams, charts and widgets), and pages load faster. Each library's licence
is in `licenses/`.

| Folder | Package | Version | Licence | What it's for |
|---|---|---|---|---|
| `pdfjs/` | pdfjs-dist | 4.4.168 | Apache-2.0 | Showing PDFs, drawing covers |
| `marked/` | marked | 12.0.2 | MIT | Markdown in answers |
| `dompurify/` | dompurify | 3.1.6 | Apache-2.0 / MPL-2.0 | Cleaning answers' HTML |
| `katex/` | katex | 0.16.11 | MIT | Formulas (woff2 fonts only) |
| `mermaid/` | mermaid | 11.12.1 | MIT | Diagrams, drawn in its hand-drawn look (browser build, global `mermaid`) |
| `vega/` | vega, vega-lite, vega-embed | 5.33.1, 5.23.0, 6.26.0 | BSD-3-Clause | Charts (browser builds, global `vegaEmbed`) |
| `mathjs/` | mathjs | 13.1.1 | Apache-2.0 | Expressions in widgets (browser build, global `math`) |
| `fonts/` | @fontsource: Atkinson Hyperlegible Next, STIX Two Text, Noto Sans Arabic | latest at bundling | SIL OFL 1.1 | The page's fonts (woff2 only) |

## Updating one

Install the versions you want in an empty folder outside the repository:

```bash
npm install --ignore-scripts pdfjs-dist@4.4.168 marked@12.0.2 dompurify@3.1.6 katex@0.16.11 mermaid@11.12.1 vega@5 vega-lite@5 vega-embed@6.26.0 mathjs@13.1.1 @fontsource/atkinson-hyperlegible-next @fontsource/stix-two-text @fontsource/noto-sans-arabic
```

Then copy the same files from `node_modules` into the folders above, update this table, and check in a browser
that a PDF opens and that an answer with a formula, a diagram, a chart and a widget draws.

- `js/vendor.js` loads the browser builds.
- `pdfview.js` and `chat/render.js` import the ES modules.
- `index.html` links the fonts and the PDF viewer's styles.
