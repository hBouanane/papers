"""Choosing a folder on this computer for the library, in the app's own folder browser (the page can't see full
paths by itself, so the server lists them). Works the same on Windows, macOS, Linux and in Docker."""
import os
import re
import string
from pathlib import Path


def places() -> list[dict]:
    """Shortcuts at the top of the browser: your usual folders that exist here, then the drives (or /)."""
    home = Path.home()
    out = [{"name": "Home", "path": str(home)}]
    for name in ("Desktop", "Documents", "Downloads"):
        if (home / name).is_dir():
            out.append({"name": name, "path": str(home / name)})
    if os.name == "nt":
        out += [{"name": f"{d}:", "path": f"{d}:\\"} for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
    else:
        out.append({"name": "/", "path": "/"})
    return out


def _folder(path: str) -> Path:
    if not path:
        return Path.home()
    here = Path(path).expanduser()
    if not here.is_absolute():
        raise ValueError("Use a full folder path.")
    return here


def listing(path: str = "") -> dict:
    """The folders inside `path` (hidden ones left out), with its parent so you can go up."""
    here = _folder(path)
    while not here.is_dir() and here.parent != here:  # a folder not made yet: start at the nearest one that is
        here = here.parent
    if not here.is_dir():
        raise ValueError(f"There's no folder at {path}.")
    try:
        dirs = sorted((d.name for d in here.iterdir() if d.is_dir() and not d.name.startswith((".", "$"))), key=str.lower)
    except PermissionError:
        dirs = []
    parent = here.parent if here.parent != here else None
    return {"path": str(here), "parent": str(parent) if parent else "", "folders": dirs, "places": places()}


def make(path: str, name: str) -> str:
    """Create a folder called `name` inside `path`; returns its full path."""
    name = name.strip()
    if not name or re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name in (".", ".."):
        raise ValueError("Folder names can't contain < > : \" / \\ | ? *")
    new = _folder(path) / name
    if new.exists():
        raise ValueError(f"There's already a folder called {name} here.")
    new.mkdir(parents=True)
    return str(new)
