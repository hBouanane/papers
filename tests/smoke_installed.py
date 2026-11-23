"""Papers as people get it, started the way they start it. Run by CI (the `installed` job) on Windows, macOS and Linux
against the built package installed in a clean environment; not part of the unit tests (it starts real processes).

    python tests/smoke_installed.py <the clean environment's python>

Checks, in a throwaway data folder:
1. Started without a console (Windows: pythonw, like the desktop icon; elsewhere: no stdin/stdout), Papers answers,
   with the installed version, and serves a page of the app at a plain address.
2. A Papers left running is asked to stop by the next one and gives way (0.5.1+).
3. `papers shortcut` makes the desktop icon.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PY = Path(sys.argv[1])
PORT = 8123
data = Path(tempfile.mkdtemp(prefix="papers-smoke-"))
env = {**os.environ, "PAPERS_DATA": str(data), "PAPERS_KEYRING": "off", "PAPERS_CONFIG": str(data / "config.json"),
       "PAPERS_DESKTOP": str(data / "Desktop")}


def get(path: str, timeout: float = 2):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=timeout) as r:
        return r.status, r.read()


def up(patience: float = 90) -> dict:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            return json.loads(get("/api/health")[1])
        except OSError:
            time.sleep(0.5)
    raise SystemExit("Papers didn't answer")


def start(quiet: bool) -> subprocess.Popen:
    exe = PY.with_name("pythonw.exe") if quiet and os.name == "nt" else PY
    streams = {} if exe.name == "pythonw.exe" else {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    return subprocess.Popen([str(exe), "-m", "papers", "--no-browser", "--port", str(PORT)], env=env, **streams)


version = subprocess.check_output([str(PY), "-c", "import papers; print(papers.__version__)"], text=True).strip()

# 1. Without a console, the way the desktop icon starts it.
first = start(quiet=True)
health = up()
assert health.get("version") == version, f"answers {health}, installed {version}"
status, page = get("/papers/1/read")
assert status == 200 and b"<title>Papers</title>" in page, "a page of the app at a plain address"
print(f"1. started without a console: Papers {version} answers")

# 2. The next Papers asks this one to stop (same version here: it would just open it, so ask directly).
req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/app/quit", method="POST", data=b"")
urllib.request.urlopen(req, timeout=3).close()
first.wait(timeout=20)
print("2. a running Papers stops when asked")

# 3. The desktop icon.
out = subprocess.run([str(PY), "-m", "papers", "shortcut"], env=env, capture_output=True, text=True, timeout=60)
print(out.stdout.strip() or out.stderr.strip())
assert out.returncode == 0 and "Made" in out.stdout, "papers shortcut"
made = [Path(p.strip()) for p in out.stdout.split("Made", 1)[1].split("\n")[0].rstrip(".").split(",")]
assert all(m.exists() for m in made), made
for m in made:
    m.unlink()
print("3. papers shortcut makes the icon")
error = Path(env["PAPERS_CONFIG"]).parent / "last-error.txt"
assert not error.exists(), error.read_text(encoding="utf-8")
print("All good.")
