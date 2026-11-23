"""Papers as a desktop app: its own window (no tabs, no address bar) and an icon on the desktop.

    papers --app        start Papers if it isn't running, and open it in its own window
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


def _app_browser() -> str | None:
    """Edge or Chrome, which can show a page as an app window."""
    names = ["msedge", "chrome", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
    for name in names:
        if found := shutil.which(name):
            return found
    places = []
    if sys.platform == "win32":
        for root in filter(None, [os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")]):
            places += [Path(root, "Microsoft/Edge/Application/msedge.exe"), Path(root, "Google/Chrome/Application/chrome.exe")]
    elif sys.platform == "darwin":
        places += [Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                   Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    return next((str(p) for p in places if p.exists()), None)


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
    """The command the shortcut runs: the `papers` command when it's on PATH, else this Python with -m papers."""
    args = ["--app"] + ([f"--port={port}"] if port != default_port else [])
    found = shutil.which("papers")
    return (found, args) if found else (sys.executable, ["-m", "papers", *args])


def _desktop() -> Path:
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
