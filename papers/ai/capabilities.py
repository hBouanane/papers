"""What the chosen model can do, found out by asking it: can it see an image, call a tool, write clean JSON for
the visuals, and point at a place on a picture by naming grid cells?

Claude (API or subscription) can do both, and the ChatGPT subscription runs without the app's tools, so those are
known. For OpenAI-compatible providers nobody can tell from the model's name, so two tiny real requests are sent:
a small picture of one plain colour ("what colour is this?") and a question with one tool to call. Each answer is
{"ok": True / False / None (couldn't tell), "note": a sentence for Settings}. The last answers are remembered per
provider and model, so Settings can show them without asking again.
"""
import base64
import json
import random
import struct
import zlib

from papers import db
from papers.ai import openai_compat, providers
from papers.ai.errors import AIError

COLOURS = {"red": (220, 30, 30), "green": (30, 160, 60), "blue": (30, 60, 220), "yellow": (245, 215, 30)}


def png(rgb: tuple[int, int, int], size: int = 64) -> bytes:
    """A square PNG of one colour, built by hand so the check needs no imaging library."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = (b"\x00" + bytes(rgb) * size) * size
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def _refused(e: AIError) -> bool:
    """The server understood the request and said no to it (as opposed to being down, or a wrong key)."""
    return any(f"({code})" in str(e) for code in (400, 404, 415, 422, 501))


def sees_images() -> dict:
    name, rgb = random.choice(list(COLOURS.items()))
    picture = base64.b64encode(png(rgb)).decode()
    try:
        data = openai_compat.send({"messages": [{"role": "user", "content": [
            {"type": "text", "text": "What colour is this square: red, green, blue or yellow? Answer with the one word."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{picture}"}}]}]})
    except AIError as e:
        if _refused(e):
            return {"ok": False, "note": "This model doesn't take images."}
        return {"ok": None, "note": f"Couldn't check images: {e}"}
    answer = (data["choices"][0]["message"].get("content") or "").lower()
    if name in answer and not any(other in answer for other in COLOURS if other != name):
        return {"ok": True, "note": "This model can see images."}
    return {"ok": False, "note": "This model took an image but couldn't say what was in it."}


def calls_tools() -> dict:
    tool = {"type": "function", "function": {
        "name": "add", "description": "Add two numbers.",
        "parameters": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]}}}
    try:
        data = openai_compat.send({"tools": [tool], "messages": [
            {"role": "user", "content": "Use the add tool to add 17 and 25."}]})
    except AIError as e:
        if _refused(e):
            return {"ok": False, "note": "This model can't use tools, so Deep mode won't work with it. Quick does."}
        return {"ok": None, "note": f"Couldn't check tools: {e}"}
    if data["choices"][0]["message"].get("tool_calls"):
        return {"ok": True, "note": "This model can use tools, so Deep mode works."}
    return {"ok": False, "note": "This model was offered a tool and didn't use it, so Deep mode may not work. Quick does."}


def _text(data: dict) -> str:
    return data["choices"][0]["message"].get("content") or ""


def writes_json() -> dict:
    """Charts, formulas and widgets in answers are JSON; a model that can't write it cleanly leaves broken boxes."""
    a, b = random.randint(2, 40), random.randint(2, 40)
    try:
        data = openai_compat.send({"messages": [{"role": "user", "content":
            'Reply with only this JSON, filled in, and nothing else: {"sum": <the sum of ' + f"{a} and {b}" + '>, "words": ["two", "short", "words"]}'}]})
    except AIError as e:
        return {"ok": None, "note": f"Couldn't check: {e}"}
    reply = _text(data).strip()
    reply = reply.split("```")[1].removeprefix("json") if reply.count("```") >= 2 else reply  # a fenced answer is fine
    try:
        value = json.loads(reply.strip())
        good = isinstance(value, dict) and value.get("sum") == a + b and isinstance(value.get("words"), list)
    except ValueError:
        good = False
    if good:
        return {"ok": True, "note": "This model writes the charts, formulas and interactive widgets cleanly."}
    return {"ok": False, "note": "This model's JSON came back broken, so answers use diagrams and tables instead of charts and widgets."}


def points_at() -> dict:
    """Figure boxes: show a gridded picture with one coloured square and ask which cells it covers."""
    from papers import figures
    size, (c0, r0), span = 400, (random.randint(1, 5), random.randint(1, 5)), random.randint(2, 3)
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return {"ok": None, "note": "Couldn't check pointing (no imaging library)."}
    import io
    picture = Image.new("RGB", (size, size), "white")
    cell = size / figures.GRID
    ImageDraw.Draw(picture).rectangle([c0 * cell, r0 * cell, (c0 + span) * cell - 1, (r0 + span) * cell - 1], fill=(30, 60, 220))
    raw = io.BytesIO()
    picture.save(raw, "PNG")
    grid = figures.with_grid(raw.getvalue())
    if not grid:
        return {"ok": None, "note": "Couldn't check pointing."}
    try:
        data = openai_compat.send({"messages": [{"role": "user", "content": [
            {"type": "text", "text": "The picture has a grid: columns A to J, rows 1 to 10. Which cells does the blue square "
                                     "cover? Answer only as FROM to TO, the top-left cell and the bottom-right cell, like B3 to D5."},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(grid).decode()}}]}]})
    except AIError as e:
        return {"ok": None, "note": f"Couldn't check pointing: {e}"}
    import re
    cells = re.findall(r"\b([A-J])(10|[1-9])\b", _text(data).upper())
    want = [(chr(65 + c0), r0 + 1), (chr(65 + c0 + span - 1), r0 + span)]
    got = [(c, int(r)) for c, r in cells[:2]]
    close = len(got) == 2 and all(abs(ord(g[0]) - ord(w[0])) <= 1 and abs(g[1] - w[1]) <= 1 for g, w in zip(got, want))
    if close:
        return {"ok": True, "note": "This model can point at parts of a figure with numbered boxes."}
    return {"ok": False, "note": "This model couldn't point at the right place on a picture, so figures are shown without boxes."}


def _key() -> str:
    return f"ai_caps:{providers.provider()}:{providers.openai_config()['model']}"


def known() -> dict | None:
    """What is known without asking: the fixed answers for Claude and ChatGPT, or what the last check found."""
    kind = providers.backend()
    if kind in ("api", "claude-code"):
        return {"images": {"ok": True, "note": "Claude can see images."},
                "tools": {"ok": True, "note": "Claude can use tools, so Deep mode works."},
                "json": {"ok": True, "note": "Claude writes the charts, formulas and interactive widgets cleanly."},
                "pointing": {"ok": True, "note": "Claude can point at parts of a figure with numbered boxes."}, "checked": False}
    if kind == "codex":
        return {"images": {"ok": False, "note": "Through a ChatGPT subscription the figures aren't sent."},
                "tools": {"ok": False, "note": "Through a ChatGPT subscription Deep answers from the paper's text, without the app's tools."},
                "checked": False}
    try:
        return json.loads(db.setting(_key()) or "null")
    except ValueError:
        return None


def allows(skill: str) -> bool:
    """Whether to use a skill ("tools", "json", "pointing") with the chosen model: yes unless a check found it can't."""
    return ((known() or {}).get(skill) or {}).get("ok") is not False


def check() -> dict:
    """Ask the model (OpenAI-compatible providers), remember the answers, and set "Look at figures" to match."""
    if providers.backend() != "openai":
        return known()
    found = {"images": sees_images(), "tools": calls_tools(), "json": writes_json(), "checked": True}
    sees = found["images"]["ok"]
    found["pointing"] = (points_at() if sees else {"ok": None, "note": "Couldn't check pointing."} if sees is None
                         else {"ok": False, "note": "No boxes on figures: this model can't see them."})
    if found["images"]["ok"] is not None or found["tools"]["ok"] is not None:  # nothing learned: nothing to remember
        db.set_setting(_key(), json.dumps(found))
    if found["images"]["ok"] is not None:
        db.set_setting("ai_vision", "on" if found["images"]["ok"] else "off")
    return found
