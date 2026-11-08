"""The `papers` command: start the app and open it in your browser.

    papers                     start on http://localhost:8000 and open the browser
    papers --port 9000         another port
    papers --data D:\\Papers   keep the database and PDFs somewhere else
    papers --host 0.0.0.0      reachable from other devices on your network (no login: only on networks you trust)
    papers --no-browser        don't open the browser (servers, Docker)
"""
import argparse
import os
import socket
import threading
import webbrowser

from papers import __version__


def port_free(host: str, port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1" if host in ("0.0.0.0", "::") else host, port)) != 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="papers", description="An AI reading companion for research papers.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PAPERS_PORT", 8000)))
    parser.add_argument("--host", default=os.environ.get("PAPERS_HOST", "127.0.0.1"))
    parser.add_argument("--data", help="folder for the database, PDFs and figures")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--version", action="version", version=f"papers {__version__}")
    args = parser.parse_args(argv)

    if args.data:
        os.environ["PAPERS_DATA"] = os.path.abspath(os.path.expanduser(args.data))
    from papers import config  # after PAPERS_DATA is set

    url = f"http://localhost:{args.port}"
    if not port_free(args.host, args.port):
        print(f"Port {args.port} is in use. Is Papers already running? Open {url}, or start with --port 8001.")
        raise SystemExit(1)
    print(f"Papers {__version__}: your library is in {config.data_dir()}")
    print(f"Open {url} (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.2, webbrowser.open, (url,)).start()

    import uvicorn
    uvicorn.run("papers.main:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
