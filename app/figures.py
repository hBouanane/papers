"""Figures cut out of a paper's PDF, with their captions.

A figure is found by its caption ("Figure 3: ..." or "Fig. 3."), then the drawings and images just above
it on the page are gathered into one area, which is drawn as a picture. Vector diagrams work as well
as embedded images. Captions that sit above their figure, or figures without any graphics (text laid
out like a picture), are skipped rather than guessed.
"""
import io
import re

import pdfplumber

CAPTION = re.compile(r"^\s*(?:Figure|Fig\.?)\s*(\d+)\s*[.:|]", re.IGNORECASE)
NEAR = 14  # pt: graphics this close to the area join it
LABEL_NEAR = 22  # pt: text labels (titles above a diagram) may sit a little further away
MAX_GAP_ABOVE_CAPTION = 60  # pt between a figure's lowest graphic and its caption


def _graphics(page) -> list[dict]:
    """Drawings and images on the page, without page-wide rules and tiny marks."""
    items = []
    for obj in [*page.images, *page.curves, *page.rects, *page.lines]:
        w, h = obj["x1"] - obj["x0"], obj["bottom"] - obj["top"]
        if max(w, h) < 3 or (w > page.width * 0.9 and h < 3) or (w > page.width * 0.9 and h > page.height * 0.9):
            continue
        items.append({"x0": obj["x0"], "x1": obj["x1"], "top": obj["top"], "bottom": obj["bottom"]})
    return items


def _caption_text(lines: list[dict], start: int) -> str:
    """The caption line and the lines that follow it closely."""
    parts = [lines[start]["text"]]
    for prev, line in zip(lines[start:], lines[start + 1:]):
        if line["top"] - prev["bottom"] > (prev["bottom"] - prev["top"]) * 0.9 or len(" ".join(parts)) > 600:
            break
        parts.append(line["text"])
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _area_above(caption: dict, graphics: list[dict], labels: list[dict]) -> dict | None:
    """The graphics just above a caption, grown to everything that touches them: more graphics, and short
    text lines (axis labels, panel titles), which is how the panels of a multi-part figure join up."""
    column = (caption["x0"] - 40, caption["x1"] + 40)
    seeds = [g for g in graphics if caption["top"] - MAX_GAP_ABOVE_CAPTION <= g["bottom"] <= caption["top"] + 2
             and g["x1"] > column[0] and g["x0"] < column[1]]
    if not seeds:
        return None
    area = {k: f([s[k] for s in seeds]) for k, f in (("x0", min), ("x1", max), ("top", min), ("bottom", max))}
    grew = True
    while grew:
        grew = False
        for g in [*graphics, *labels]:
            if g["bottom"] > caption["top"] + 2:
                continue
            near = LABEL_NEAR if g.get("label") else NEAR
            touches = (g["x0"] <= area["x1"] + near and g["x1"] >= area["x0"] - near
                       and g["top"] <= area["bottom"] + near and g["bottom"] >= area["top"] - near)
            inside = all(area[k] == v for k, v in (("x0", min(area["x0"], g["x0"])), ("x1", max(area["x1"], g["x1"])),
                                                  ("top", min(area["top"], g["top"])), ("bottom", max(area["bottom"], g["bottom"]))))
            if touches and not inside:
                area = {"x0": min(area["x0"], g["x0"]), "x1": max(area["x1"], g["x1"]),
                        "top": min(area["top"], g["top"]), "bottom": max(area["bottom"], g["bottom"])}
                grew = True
    if area["x1"] - area["x0"] < 40 or area["bottom"] - area["top"] < 30:
        return None
    return area


def extract(data: bytes, resolution: int = 200) -> list[dict]:
    """[{number, page, caption, png}] for each figure found, in order, one per number."""
    found: dict[int, dict] = {}
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            lines = page.extract_text_lines(x_tolerance=1.2)
            captions = [(i, line) for i, line in enumerate(lines) if CAPTION.match(line["text"])]
            if not captions:
                continue
            graphics = _graphics(page)
            # Labels and panel titles are a few words ("Multi-Head Attention", "(b) CIFAR-100"); prose lines
            # are longer, and captions never join a figure.
            labels = [{**{k: l[k] for k in ("x0", "x1", "top", "bottom")}, "label": True} for l in lines
                      if (len(l["text"].split()) <= 5 or re.match(r"\s*\([a-z]\)", l["text"]))
                      and not CAPTION.match(l["text"])]
            for i, line in captions:
                number = int(CAPTION.match(line["text"])[1])
                if number in found:
                    continue
                area = _area_above(line, graphics, labels)
                if not area:
                    continue
                # Room around it for labels drawn as text next to the graphics.
                box = (max(0, area["x0"] - 14), max(0, area["top"] - 8),
                       min(page.width, area["x1"] + 14), min(page.height, line["top"] - 1))
                if box[3] - box[1] < 30:
                    continue
                out = io.BytesIO()
                page.crop(box).to_image(resolution=resolution).save(out, format="PNG")
                found[number] = {"number": number, "page": page_no, "caption": _caption_text(lines, i), "png": out.getvalue()}
    return [found[n] for n in sorted(found)]


# ---------- Stored per paper, next to its PDF ----------
import json  # noqa: E402
import shutil  # noqa: E402

from app import db  # noqa: E402


def folder(paper_id: int):
    return db.pdf_path(paper_id).parent.parent / "figures" / str(paper_id)


def for_paper(paper_id: int) -> list[dict]:
    """The paper's figures ({number, page, caption}), cut out once and kept."""
    pdf_file = db.pdf_path(paper_id)
    if not pdf_file.exists():
        return []
    base = folder(paper_id)
    index = base / "index.json"
    if index.exists():
        return json.loads(index.read_text(encoding="utf-8"))
    try:
        found = extract(pdf_file.read_bytes())
    except Exception:  # a PDF pdfplumber can't read: no figures, the rest of the app still works
        found = []
    base.mkdir(parents=True, exist_ok=True)
    for f in found:
        (base / f"{f['number']}.png").write_bytes(f["png"])
    listing = [{k: f[k] for k in ("number", "page", "caption")} for f in found]
    index.write_text(json.dumps(listing), encoding="utf-8")
    return listing


def forget(paper_id: int) -> None:
    """A new PDF (or a deleted paper): cut them out again next time."""
    shutil.rmtree(folder(paper_id), ignore_errors=True)
