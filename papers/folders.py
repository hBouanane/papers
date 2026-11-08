"""Choosing a folder on this computer for the library.

Two ways, because the page itself can't see full paths:
- `pick()` opens the system's own folder dialog (on the computer running the app), when it has a screen.
- `listing()` lists the folders inside a folder, for the in-app browser used when there is no dialog
  (for example when the app runs in Docker).
"""
import os
import string
import subprocess
import sys
from pathlib import Path

# A tiny program run on its own, so a dialog never blocks the server and a missing Tk only fails here.
# Exit code 3 means "no dialog possible here"; an empty answer means the user cancelled.
_DIALOG = r"""
import sys
try:
    import tkinter
    from tkinter import filedialog
    root = tkinter.Tk()
except Exception:
    sys.exit(3)
root.withdraw()
root.attributes("-topmost", True)  # in front of the browser, not hidden behind it
chosen = filedialog.askdirectory(initialdir=sys.argv[1] or None, title="Choose a folder for your library", mustexist=False)
print(chosen or "", end="")
"""


class NoDialog(Exception):
    """The system folder dialog can't be shown on this computer."""


def pick(start: str = "") -> str:
    """Ask with the system folder dialog. Returns the full path, or "" if the user cancelled."""
    if os.environ.get("PAPERS_NO_DIALOG") or (sys.platform.startswith("linux") and not os.environ.get("DISPLAY")
                                              and not os.environ.get("WAYLAND_DISPLAY")):
        raise NoDialog()
    try:
        done = subprocess.run([sys.executable, "-c", _DIALOG, start], capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        raise NoDialog()
    if done.returncode != 0:  # 3: no Tk or no screen
        raise NoDialog()
    return str(Path(done.stdout.strip())) if done.stdout.strip() else ""


def roots() -> list[str]:
    """Where browsing starts: the drives on Windows, / elsewhere."""
    if os.name == "nt":
        return [f"{d}:\\" for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
    return ["/"]


def listing(path: str = "") -> dict:
    """The folders inside `path` (hidden ones left out), with its parent so you can go up."""
    if not path:
        here = Path.home()
    else:
        here = Path(path).expanduser()
        if not here.is_absolute():
            raise ValueError("Use a full folder path.")
    while not here.is_dir() and here.parent != here:  # a folder not made yet: start at the nearest one that is
        here = here.parent
    if not here.is_dir():
        raise ValueError(f"There's no folder at {path}.")
    try:
        dirs = sorted((d.name for d in here.iterdir() if d.is_dir() and not d.name.startswith((".", "$"))),
                      key=str.lower)
    except PermissionError:
        dirs = []
    parent = here.parent if here.parent != here else None
    return {"path": str(here), "parent": str(parent) if parent else "", "folders": dirs,
            "home": str(Path.home()), "roots": roots()}
