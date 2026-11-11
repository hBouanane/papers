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
import webbrowser

from papers import __version__


def port_free(host: str, port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1" if host in ("0.0.0.0", "::") else host, port)) != 0


GOOD_PYTHON = "3.13"  # a released Python every library here supports


def check_python(argv: list[str] | None = None) -> None:
    """Load the app's libraries before asking anything. On a Python they can't run on (a pre-release, or one newer
    than they support) the app would crash halfway through setup; instead it starts itself again on a Python that
    works, when uv is there to fetch one, or says in one line what to do."""
    try:
        import papers.ai  # noqa: F401  (pulls in pydantic and the AI clients, the parts tied to the Python version)
        return
    except Exception as e:  # anything: these are other packages' import errors
        why = f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"
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
    check_python(argv)
    from papers import config, setup  # after PAPERS_DATA is set

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
    if setup.interactive():
        setup.started(url, config.data_dir().resolve())
    else:
        print(f"Papers {__version__}: your library is in {config.data_dir()}")
        print(f"Open {url} (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.2, webbrowser.open, (url,)).start()

    import uvicorn
    uvicorn.run("papers.main:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
