"""What the chosen model can do, found out by asking it: can it see an image, can it call a tool?

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


def _key() -> str:
    return f"ai_caps:{providers.provider()}:{providers.openai_config()['model']}"


def known() -> dict | None:
    """What is known without asking: the fixed answers for Claude and ChatGPT, or what the last check found."""
    kind = providers.backend()
    if kind in ("api", "claude-code"):
        return {"images": {"ok": True, "note": "Claude can see images."},
                "tools": {"ok": True, "note": "Claude can use tools, so Deep mode works."}, "checked": False}
    if kind == "codex":
        return {"images": {"ok": False, "note": "Through a ChatGPT subscription the figures aren't sent."},
                "tools": {"ok": False, "note": "Through a ChatGPT subscription Deep answers from the paper's text, without the app's tools."},
                "checked": False}
    try:
        return json.loads(db.setting(_key()) or "null")
    except ValueError:
        return None


def check() -> dict:
    """Ask the model (OpenAI-compatible providers), remember the answers, and set "Look at figures" to match."""
    if providers.backend() != "openai":
        return known()
    found = {"images": sees_images(), "tools": calls_tools(), "checked": True}
    if found["images"]["ok"] is not None or found["tools"]["ok"] is not None:  # nothing learned: nothing to remember
        db.set_setting(_key(), json.dumps(found))
    if found["images"]["ok"] is not None:
        db.set_setting("ai_vision", "on" if found["images"]["ok"] else "off")
    return found
