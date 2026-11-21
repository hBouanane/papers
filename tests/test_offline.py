"""Papers works without internet: the page loads nothing from outside, and the libraries it needs are bundled."""
import re

from papers import config

STATIC = config.STATIC_DIR
# Things the page *loads* (scripts, imports, stylesheets, images); a link the reader clicks is fine.
OUTSIDE = re.compile(r"""(?:\bsrc\s*=\s*|import\(\s*|\bfrom\s+|<link[^>]*\bhref\s*=\s*|url\(\s*)[`'"]?https?://""", re.IGNORECASE)


def test_the_page_loads_nothing_from_outside():
    found = []
    for path in [STATIC / "index.html", *STATIC.glob("js/**/*.js"), *STATIC.glob("css/**/*.css")]:
        text = path.read_text(encoding="utf-8")
        found += [f"{path.relative_to(STATIC)}: {m.group(0)}" for m in OUTSIDE.finditer(text)]
        found += [f"{path.relative_to(STATIC)}: {u}" for u in re.findall(r"https://(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|unpkg\.com)/[^\s'\"`)]+", text)
                  if "PAGE_POLICY" not in text[max(0, text.find(u) - 200):text.find(u)]]
    assert found == []


def test_the_bundled_libraries_are_there():
    for name in ("pdfjs/pdf.min.mjs", "pdfjs/pdf.worker.min.mjs", "pdfjs/pdf_viewer.mjs", "pdfjs/pdf_viewer.css",
                 "marked/marked.esm.js", "dompurify/purify.es.mjs", "katex/katex.mjs", "katex/katex.min.css",
                 "mermaid/mermaid.min.js", "vega/vega.min.js", "vega/vega-lite.min.js", "vega/vega-embed.min.js",
                 "mathjs/math.js", "fonts/fonts.css"):
        assert (STATIC / "vendor" / name).stat().st_size > 1000, name
    css = (STATIC / "vendor/fonts/fonts.css").read_text(encoding="utf-8")
    for font in re.findall(r"url\(\./([^)]+)\)", css):
        assert (STATIC / "vendor/fonts" / font).exists(), font


def test_bundled_files_are_served(client):
    r = client.get("/vendor/pdfjs/pdf.worker.min.mjs")
    assert r.status_code == 200 and "javascript" in r.headers["content-type"]
