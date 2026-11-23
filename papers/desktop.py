"""Papers as a desktop app: its own window (no tabs, no address bar) and an icon on the desktop.

    papers              start Papers if it isn't running, and open it in its own window (closing it stops Papers)
    papers shortcut     put a Papers icon on the desktop (and in the apps menu on Linux) that does the same

The window is Microsoft Edge's or Google Chrome's "app" mode, when one of them is installed; otherwise the usual
browser opens. Nothing is installed: the shortcut only runs `papers --app`.
"""
import os
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

ICONS = Path(__file__).parent / "static" / "icons"


def address(host: str, port: int) -> str:
    """Where to open Papers: papers.localhost (it's this computer, as localhost is, with a name of its own) in
    browsers that know it; macOS's Safari doesn't, so plain localhost there."""
    name = "localhost" if sys.platform == "darwin" else "papers.localhost"
    return f"http://{name}:{port}" if host in ("127.0.0.1", "localhost", "0.0.0.0", "::", "::1") else f"http://{host}:{port}"


# Browsers that can show a page as an app window (--app): Edge, Chrome, Chromium, Brave and Vivaldi, on Windows,
# macOS and Linux. Firefox and Safari can't; with them Papers opens in a tab (closing the tab stops it the same way).
COMMANDS = ["msedge", "microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable", "chrome",
            "chromium", "chromium-browser", "brave-browser", "brave", "vivaldi", "vivaldi-stable"]
WINDOWS = ["Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe",
           "BraveSoftware/Brave-Browser/Application/brave.exe", "Vivaldi/Application/vivaldi.exe", "Chromium/Application/chrome.exe"]
MAC = ["Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Google Chrome.app/Contents/MacOS/Google Chrome",
       "Chromium.app/Contents/MacOS/Chromium", "Brave Browser.app/Contents/MacOS/Brave Browser", "Vivaldi.app/Contents/MacOS/Vivaldi"]


def _app_browser() -> str | None:
    """A browser that can show a page as an app window, or None."""
    places = []
    if sys.platform == "win32":
        roots = [r for r in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")) if r]
        places = [Path(root, rel) for rel in WINDOWS for root in roots]  # Edge first, wherever it is
    elif sys.platform == "darwin":
        places = [Path(root, rel) for root in ("/Applications", Path.home() / "Applications") for rel in MAC]
    found = next((str(p) for p in places if p.exists()), None)
    return found or next((path for name in COMMANDS if (path := shutil.which(name))), None)


def open_window(url: str) -> None:
    """Open Papers in its own window, or in the browser when there's no Edge or Chrome."""
    browser = _app_browser()
    if browser:
        try:
            subprocess.Popen([browser, f"--app={url}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            pass
    webbrowser.open(url)


def _launcher(port: int, default_port: int) -> tuple[str, list[str]]:
    """The command the shortcut runs. On Windows, this Python without a console window (pythonw): the Papers window is
    all you see, and closing it stops Papers. Elsewhere the `papers` command when it's on PATH, else this Python."""
    args = [f"--port={port}"] if port != default_port else []
    if sys.platform == "win32":
        quiet = Path(sys.executable).with_name("pythonw.exe")
        return (str(quiet) if quiet.exists() else sys.executable), ["-m", "papers", *args]
    found = shutil.which("papers")
    return (found, args) if found else (sys.executable, ["-m", "papers", *args])


def _desktop() -> Path:
    if env := os.environ.get("PAPERS_DESKTOP"):  # tests and checks: never the real desktop
        return Path(env)
    if sys.platform == "win32":  # the real Desktop, also when OneDrive moved it
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
                                 capture_output=True, text=True, timeout=20).stdout.strip()
            if out:
                return Path(out)
        except (OSError, subprocess.SubprocessError):
            pass
    return Path.home() / "Desktop"


def create_shortcut(port: int, default_port: int = 8000) -> list[Path]:
    """Put a Papers icon on the desktop (and the apps menu on Linux). Returns what was made."""
    target, args = _launcher(port, default_port)
    desktop = _desktop()
    desktop.mkdir(parents=True, exist_ok=True)
    made = []
    if sys.platform == "win32":
        link = desktop / "Papers.lnk"
        q = lambda s: str(s).replace("'", "''")  # noqa: E731  (PowerShell's single quotes)
        script = (f"$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{q(link)}'); "
                  f"$s.TargetPath = '{q(target)}'; $s.Arguments = '{q(' '.join(args))}'; "
                  f"$s.IconLocation = '{q(ICONS / 'papers.ico')}'; $s.WorkingDirectory = '{q(Path.home())}'; "
                  "$s.WindowStyle = 7; $s.Description = 'Papers: your library of research papers'; $s.Save()")
        subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, capture_output=True, timeout=30)
        made.append(link)
    elif sys.platform == "darwin":
        command = desktop / "Papers.command"
        command.write_text("#!/bin/sh\n# Opens Papers in its own window (made by `papers shortcut`).\n"
                           f"exec {' '.join(_sh(x) for x in [target, *args])}\n", encoding="utf-8")
        command.chmod(0o755)
        made.append(command)
    else:
        entry = ("[Desktop Entry]\nType=Application\nName=Papers\nComment=Your library of research papers\n"
                 f"Exec={' '.join(_sh(x) for x in [target, *args])}\nIcon={ICONS / 'icon-512.png'}\nTerminal=false\n"
                 "Categories=Education;Office;\n")
        for folder in (Path.home() / ".local/share/applications", desktop):
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / "papers.desktop"
            path.write_text(entry, encoding="utf-8")
            path.chmod(0o755)
            made.append(path)
    return made


def _sh(word: str) -> str:
    return word if word and all(c.isalnum() or c in "-_./=:" for c in word) else "'" + word.replace("'", "'\\''") + "'"
