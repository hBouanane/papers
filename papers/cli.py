"""The `papers` command: start the app and open it in your browser.

    papers                     start on http://localhost:8000 and open the browser (the first time, a short setup)
    papers setup               the setup again: where your library is kept, which AI to use
    papers --no-setup          skip the setup (it's also skipped outside a terminal and with --data)
    papers --port 9000         another port
    papers --data D:\\Papers   keep the database and PDFs somewhere else
    papers --host 0.0.0.0      reachable from other devices on your network (no login: only on networks you trust)
    papers --no-browser        don't open the browser (servers, Docker)
"""
import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from contextlib import contextmanager

from papers import __version__


def port_free(host: str, port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1" if host in ("0.0.0.0", "::") else host, port)) != 0


GOOD_PYTHON = "3.13"  # a released Python every library here supports


@contextmanager
def working(message: str):
    """A spinner with a few words while something slow happens, so the terminal never just sits there.
    Loading the libraries takes seconds, and much longer the first time after installing."""
    if not (sys.stdout.isatty() and not os.environ.get("CI")):
        yield
        return
    from rich.console import Console
    with Console().status(f"[dim]{message}[/]", spinner="dots", spinner_style="#6f8cf0"):
        yield


def python_problem() -> str | None:
    """Load the app's libraries; the reason, if this Python can't run them (a pre-release, or one too new)."""
    try:
        import pydantic

        import papers.ai  # noqa: F401  (the AI clients and everything they pull in)

        class Probe(pydantic.BaseModel):  # how pydantic reads a written-out type is what breaks first
            value: "str"
        return None
    except Exception as e:  # anything: these are other packages' errors
        return f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"


def check_python(argv: list[str] | None = None, why: str | None = None) -> None:
    """On a Python the libraries can't run on, the app would crash halfway through setup. Instead it starts itself
    again on a Python that works, when uv is there to fetch one, or says in one line what to do."""
    why = why or python_problem()
    if not why:
        return
    version = sys.version.split()[0]
    uvx = shutil.which("uvx")
    if uvx and not os.environ.get("PAPERS_PYTHON_RETRY"):  # once: never loop
        print(f"This Python ({version}) is not supported by one of Papers' libraries. "
              f"Starting again on Python {GOOD_PYTHON}…\n")
        args = sys.argv[1:] if argv is None else argv
        again = [uvx, "--python", GOOD_PYTHON, f"papers-app=={__version__}", *args]
        raise SystemExit(subprocess.call(again, env={**os.environ, "PAPERS_PYTHON_RETRY": "1"}))
    print(f"Papers can't start on this Python ({version}): one of its libraries doesn't support it yet.")
    print(f"  {why}")
    print("Run it on a released Python instead, for example:")
    print(f"  uvx --python {GOOD_PYTHON} papers-app")
    raise SystemExit(1)


def wait_until_up(host: str, port: int, patience: float = 120) -> bool:
    """True once the app answers on its port (False after `patience` seconds)."""
    address = f"http://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{port}/api/health"
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            with urllib.request.urlopen(address, timeout=2) as answer:
                if answer.status == 200:
                    return True
        except OSError:
            pass
        time.sleep(0.25)
    return False


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="papers", description="An AI reading companion for research papers.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PAPERS_PORT", 8000)))
    parser.add_argument("--host", default=os.environ.get("PAPERS_HOST", "127.0.0.1"))
    parser.add_argument("--data", help="folder for the database, PDFs and figures")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--no-setup", action="store_true", help="don't ask the first-run questions")
    parser.add_argument("command", nargs="?", choices=["setup"], help="setup: ask where to keep things and which AI to use")
    parser.add_argument("--version", action="version", version=f"papers {__version__}")
    args = parser.parse_args(argv)

    if args.data:
        os.environ["PAPERS_DATA"] = os.path.abspath(os.path.expanduser(args.data))
    with working("Loading Papers…"):
        why = python_problem()
        if not why:
            from papers import config, setup  # after PAPERS_DATA is set
    if why:
        check_python(argv, why)

    if args.command == "setup":
        if not setup.interactive():
            print("papers setup needs a terminal to ask its questions.")
            raise SystemExit(1)
        setup.run()
        if input("\n  Start Papers now? [Y/n] ").strip().lower() in ("n", "no"):
            return
    elif not args.no_setup and setup.needed():
        setup.run()

    url = f"http://localhost:{args.port}"
    if not port_free(args.host, args.port):
        print(f"Port {args.port} is in use. Is Papers already running? Open {url}, or start with --port 8001.")
        raise SystemExit(1)
    def announce() -> None:
        """Say where the app is, and open it, once it really answers: a link that leads to an error page is
        worse than a few seconds of "Starting"."""
        with working("Starting Papers…"):
            ready = wait_until_up(args.host, args.port)
        if setup.interactive():
            setup.started(url, config.data_dir().resolve())
        else:
            print(f"Papers {__version__}: your library is in {config.data_dir()}", flush=True)
            print(f"Open {url} (Ctrl+C to stop)", flush=True)
        if not ready:
            print("  It is taking long to start. If the page doesn't open yet, wait a moment and reload it.")
        if not args.no_browser:
            webbrowser.open(url)
    threading.Thread(target=announce, daemon=True).start()

    import uvicorn
    uvicorn.run("papers.main:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
