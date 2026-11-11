"""Figures cut out of a paper's PDF, with their captions.

A figure is found by its caption ("Figure 3: ..." or "Fig. 3."), then the drawings and images just above
it on the page are gathered into one area, which is drawn as a picture. Vector diagrams work as well
as embedded images. Captions that sit above their figure, or figures without any graphics (text laid
out like a picture), are skipped rather than guessed.
"""
import io
import json
import re
import shutil

import pdfplumber

from papers import config, db

CAPTION = re.compile(r"^\s*(?:Figure|Fig\.?)\s*(\d+)\s*[.:|]", re.IGNORECASE)
TABLE_CAPTION = re.compile(r"^\s*Table\s*(\d+)\s*[.:|]", re.IGNORECASE)
RULE_FROM_CAPTION = 30  # pt: a table's first rule sits this close to its caption (below it, or above for captions under tables)
RULE_GAP = 260  # pt: rules further apart than this belong to different tables
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
            table_captions = [(i, line) for i, line in enumerate(lines) if TABLE_CAPTION.match(line["text"])]
            if not captions and not table_captions:
                continue
            graphics = _graphics(page)
            # Labels and panel titles are a few words ("Multi-Head Attention", "(b) CIFAR-100"); prose lines
            # are longer, and captions never join a figure.
            labels = [{**{k: l[k] for k in ("x0", "x1", "top", "bottom")}, "label": True} for l in lines
                      if (len(l["text"].split()) <= 5 or re.match(r"\s*\([a-z]\)", l["text"]))
                      and not CAPTION.match(l["text"]) and not TABLE_CAPTION.match(l["text"])]
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
                found[("figure", number)] = {"kind": "figure", "number": number, "page": page_no,
                                             "caption": _caption_text(lines, i), "png": out.getvalue()}
            for i, line in table_captions:
                number = int(TABLE_CAPTION.match(line["text"])[1])
                if ("table", number) in found:
                    continue
                # Measure from the end of the whole caption: long captions run over several lines.
                end = i
                rule_tops = [r["top"] for r in _rules(page)]
                while (end + 1 < len(lines) and lines[end + 1]["top"] - lines[end]["bottom"] <= (lines[end]["bottom"] - lines[end]["top"]) * 0.9
                       and not any(lines[end]["bottom"] - 1 <= t <= lines[end + 1]["top"] + 1 for t in rule_tops)):
                    end += 1  # (a rule means the table has started)
                block = {**line, "bottom": lines[end]["bottom"], "x1": max(l["x1"] for l in lines[i:end + 1])}
                box = _table_box(block, page, [l for _, l in [*captions, *table_captions] if l is not line], lines)
                if not box:
                    continue
                out = io.BytesIO()
                page.crop(box).to_image(resolution=resolution).save(out, format="PNG")
                caption_text = re.sub(r"\s+", " ", " ".join(l["text"] for l in lines[i:end + 1])).strip()
                found[("table", number)] = {"kind": "table", "number": number, "page": page_no,
                                            "caption": caption_text, "png": out.getvalue()}
    return [found[k] for k in sorted(found, key=lambda k: (k[0] != "figure", k[1]))]


def _rules(page) -> list[dict]:
    """Horizontal rules (the lines that frame a table and its header)."""
    rules = []
    for obj in [*page.lines, *page.rects, *page.edges]:
        w, h = obj["x1"] - obj["x0"], obj["bottom"] - obj["top"]
        if w > 40 and h < 2.5 and w < page.width * 0.95:
            rules.append({"x0": obj["x0"], "x1": obj["x1"], "top": obj["top"], "bottom": obj["bottom"]})
    return sorted(rules, key=lambda r: r["top"])


def _table_box(caption: dict, page, captions: list[dict], lines: list[dict]):
    """The area of the table that goes with a caption: the run of rules starting right below the caption
    (or, for captions under their table, ending right above it). Tables without rules are skipped."""
    rules = [r for r in _rules(page) if r["x0"] < caption["x1"] and r["x1"] > caption["x0"]]
    others = captions

    def crosses_caption(a, b):  # another caption between two rules: not the same table
        return any(a < c["top"] < b for c in others)

    def same_table(r, first):  # a table's rules are about as wide as each other (a footnote rule is short)
        return (r["x1"] - r["x0"]) >= 0.6 * (first["x1"] - first["x0"])

    def prose_between(a, b):  # a paragraph between two rules: the table has ended
        return any(a < l["top"] < b and len(l["text"].split()) >= 14 for l in lines)

    def chart_in(top, bottom):  # curves or pictures inside: that's a chart, not a table
        inside = [g for g in [*page.curves, *page.images] if g["top"] < bottom and g["bottom"] > top]
        return len(inside) > 3

    def run_from(candidates, step):
        run = [candidates[0]]
        for r in candidates[1:]:
            if not same_table(r, run[0]):
                continue
            a, b = sorted((run[-1]["top"], r["top"]))
            if b - a > RULE_GAP or crosses_caption(a, b) or prose_between(a, b):
                break
            run.append(r)
        top, bottom = min(r["top"] for r in run) - 2, max(r["bottom"] for r in run) + 2
        if len(run) < 2 or bottom - top < 20 or chart_in(top, bottom):
            return None
        return run, top, bottom

    below = [r for r in rules if r["top"] >= caption["bottom"] - 1]
    above = [r for r in reversed(rules) if r["bottom"] <= caption["top"] + 1]
    found = None
    if below and below[0]["top"] - caption["bottom"] <= RULE_FROM_CAPTION:
        found = run_from(below, 1)
    if not found and above and caption["top"] - above[0]["bottom"] <= RULE_FROM_CAPTION:
        found = run_from(above, -1)
    if not found:
        return None
    run, top, bottom = found
    x0, x1 = min(r["x0"] for r in run), max(r["x1"] for r in run)
    return (max(0, x0 - 6), max(0, top), min(page.width, x1 + 6), min(page.height, bottom))


# ---------- Stored per paper, next to its PDF ----------

VERSION = 3  # figures and tables; table captions stop at the table

def folder(paper_id: int):
    return config.data_dir() / "figures" / str(paper_id)


def known(paper_id: int) -> list[dict]:
    """The figures already cut out for this paper (none if that hasn't happened yet); never cuts them out itself."""
    index = folder(paper_id) / "index.json"
    try:
        stored = json.loads(index.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return stored["items"] if isinstance(stored, dict) and stored.get("version") == VERSION else []


def for_paper(paper_id: int) -> list[dict]:
    """The paper's figures and tables ({kind, number, page, caption}), cut out once and kept."""
    pdf_file = db.pdf_path(paper_id)
    if not pdf_file.exists():
        return []
    base = folder(paper_id)
    index = base / "index.json"
    if index.exists():
        stored = json.loads(index.read_text(encoding="utf-8"))
        if isinstance(stored, dict) and stored.get("version") == VERSION:
            return stored["items"]
    try:
        found = extract(pdf_file.read_bytes())
    except Exception:  # a PDF pdfplumber can't read: no figures, the rest of the app still works
        found = []
    base.mkdir(parents=True, exist_ok=True)
    for f in found:
        (base / image_name(f["kind"], f["number"])).write_bytes(f["png"])
    listing = [{k: f[k] for k in ("kind", "number", "page", "caption")} for f in found]
    index.write_text(json.dumps({"version": VERSION, "items": listing}), encoding="utf-8")
    return listing


def image_name(kind: str, number: int) -> str:
    return f"{kind}-{number}.png"


# ---------- A grid for the model to point with ----------

GRID = 10  # columns A–J, rows 1–10
COLUMNS = "ABCDEFGHIJ"


def with_grid(png: bytes) -> bytes | None:
    """The figure with a lettered grid drawn over it, for the model only: it names cells ("C4") to point at a part,
    which it does far better than guessing coordinates. None if the image can't be drawn on."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        picture = Image.open(io.BytesIO(png)).convert("RGB")
        if picture.width < 700:  # small cut-outs: enlarge so the cell names stay readable
            scale = 700 / picture.width
            picture = picture.resize((700, max(1, round(picture.height * scale))))
        w, h = picture.size
        left, top = 34, 28
        sheet = Image.new("RGB", (w + left, h + top), "white")
        sheet.paste(picture, (left, top))
        ink = ImageDraw.Draw(sheet, "RGBA")
        try:
            big, small = ImageFont.load_default(size=18), ImageFont.load_default(size=12)
        except TypeError:  # an older Pillow: one fixed size
            big = small = ImageFont.load_default()
        line, name = (220, 0, 120, 110), (200, 0, 110, 255)
        for i in range(GRID + 1):
            x, y = left + round(w * i / GRID), top + round(h * i / GRID)
            ink.line([(x, top), (x, top + h)], fill=line, width=1)
            ink.line([(left, y), (left + w, y)], fill=line, width=1)
        for i in range(GRID):
            ink.text((left + w * (i + .5) / GRID - 5, 4), COLUMNS[i], fill=name, font=big)
            ink.text((6 if i < 9 else 2, top + h * (i + .5) / GRID - 10), str(i + 1), fill=name, font=big)
        for r in range(GRID):
            for c in range(GRID):
                x, y = left + w * c / GRID + 3, top + h * r / GRID + 2
                label = f"{COLUMNS[c]}{r + 1}"
                ink.rectangle([x - 1, y, x + 7 * len(label) + 1, y + 13], fill=(255, 255, 255, 170))
                ink.text((x, y), label, fill=(200, 0, 110, 200), font=small)
        out = io.BytesIO()
        sheet.save(out, "PNG")
        return out.getvalue()
    except Exception:
        return None


def forget(paper_id: int) -> None:
    """A new PDF (or a deleted paper): cut them out again next time."""
    shutil.rmtree(folder(paper_id), ignore_errors=True)
