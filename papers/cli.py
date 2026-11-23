"""The `papers` command: start the app and open it in your browser.

    papers                     start on http://papers.localhost:8000 and open it in a window of its own (the first
                               time, a short setup); closing the window stops Papers
    papers --browser           open it in a tab of your usual browser instead (it keeps running until Ctrl+C)
    papers shortcut            put a Papers icon on the desktop that opens it in its own window
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

from papers import __version__, desktop


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


def running(host: str, port: int) -> dict | None:
    """What answers on this port: Papers' health ({ok, version} from 0.5.1 on, {ok} before), or None."""
    import json
    try:
        with urllib.request.urlopen(f"http://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{port}/api/health", timeout=2) as r:
            return json.loads(r.read() or b"{}")
    except (OSError, ValueError):
        return None


def ask_to_quit(host: str, port: int, patience: float = 15) -> bool:
    """Ask the Papers on this port to stop, and wait until the port is free. False if it didn't."""
    try:
        request = urllib.request.Request(f"http://127.0.0.1:{port}/api/app/quit", method="POST", data=b"")
        urllib.request.urlopen(request, timeout=3).close()
    except OSError:
        return False
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if port_free(host, port):
            return True
        time.sleep(0.3)
    return False


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
    # Started without a console (the desktop icon on Windows runs pythonw): there's nowhere to print, so nothing is.
    for name, mode in (("stdin", "r"), ("stdout", "w"), ("stderr", "w")):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, mode, encoding="utf-8"))  # noqa: SIM115  (open for the whole run)
    parser = argparse.ArgumentParser(prog="papers", description="An AI reading companion for research papers.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PAPERS_PORT", 8000)))
    parser.add_argument("--host", default=os.environ.get("PAPERS_HOST", "127.0.0.1"))
    parser.add_argument("--data", help="folder for the database, PDFs and figures")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--no-setup", action="store_true", help="don't ask the first-run questions")
    parser.add_argument("--browser", action="store_true", help="open Papers in a tab of your browser, not its own window")
    parser.add_argument("--app", action="store_true", help=argparse.SUPPRESS)  # the default now; older shortcuts pass it
    parser.add_argument("command", nargs="?", choices=["setup", "shortcut"],
                        help="setup: ask where to keep things and which AI to use; shortcut: a Papers icon on the desktop")
    parser.add_argument("--version", action="version", version=f"papers {__version__}")
    args = parser.parse_args(argv)
    if args.command == "shortcut":
        try:
            made = desktop.create_shortcut(args.port, parser.get_default("port"))
        except (OSError, subprocess.SubprocessError) as e:
            print(f"Couldn't make the shortcut: {e}")
            raise SystemExit(1)
        print(f"Made {', '.join(str(m) for m in made)}.")
        print("Double-click it to open Papers in its own window "
              "(it starts Papers first when it isn't running).")
        return

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
        setup.run(port=args.port)
        if input("\n  Start Papers now? [Y/n] ").strip().lower() in ("n", "no"):
            return
    elif not args.no_setup and setup.needed():
        setup.run(port=args.port)

    url = desktop.address(args.host, args.port)
    if not port_free(args.host, args.port):
        there = running(args.host, args.port)
        if there and there.get("version") == __version__:  # this Papers is already running: just open it
            if not args.no_browser:
                webbrowser.open(url) if args.browser else desktop.open_window(url)
            return
        if there and there.get("version") and ask_to_quit(args.host, args.port):
            print(f"Papers {there['version']} was running; it's replaced by {__version__}.", flush=True)
        elif there:
            # An older Papers that can't be asked to stop (before 0.5.1) still runs there, perhaps in a forgotten
            # terminal: start on the next free port instead of opening a window onto it, which wouldn't work.
            old = args.port
            while not port_free(args.host, args.port) and args.port < old + 20:
                args.port += 1
            url = desktop.address(args.host, args.port)
            print(f"An older Papers is still running on port {old} (stop it with Ctrl+C in its terminal). "
                  f"This one starts on port {args.port}.", flush=True)
        else:
            print(f"Port {args.port} is in use by another program. Start Papers with --port 8001.")
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
        own_window = not args.no_browser and not args.browser
        if args.browser:
            webbrowser.open(url)
        elif own_window:
            desktop.open_window(url)
        # In its own window, Papers stops once the window is closed (no Papers page open for a few seconds); and
        # any Papers stops when a newer one asks it to.
        from papers import presence
        while not server.should_exit:
            time.sleep(1)
            if presence.quit_requested:
                print("  A newer Papers is starting, so this one stopped.", flush=True)
                server.should_exit = True
            elif own_window and presence.all_closed():
                print("  The Papers window was closed, so Papers stopped. Open it again any time.", flush=True)
                server.should_exit = True

    import uvicorn
    # timeout_graceful_shutdown: a browser can keep a connection open after its window closes; Papers stops anyway.
    server = uvicorn.Server(uvicorn.Config("papers.main:app", host=args.host, port=args.port, log_level="warning",
                                           timeout_graceful_shutdown=3))
    threading.Thread(target=announce, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
