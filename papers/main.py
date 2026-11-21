"""The web app: the API (papers/routes/), the web pages (papers/static/), and the Inbox watcher.

Run it with `papers` (see cli.py), or for development:
    uvicorn papers.main:app --reload
"""
import asyncio
import logging
import mimetypes
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from papers import ai, config, db, index, keys, library, scholar
from papers.ai.errors import plain
from papers.ingest import import_inbox
from papers.routes import ROUTERS


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    keys.move_to_keychain()  # API keys saved in the database before move to the system keychain
    index.backfill()
    poll = config.inbox_poll_seconds()
    watcher = asyncio.create_task(watch_inbox(poll)) if poll > 0 else None
    yield
    if watcher:
        watcher.cancel()


async def watch_inbox(every: float):
    """Every few seconds: add PDFs dropped in the library folder's Inbox, and notes written in its files."""
    while True:
        await asyncio.sleep(every)
        try:
            await asyncio.to_thread(import_inbox)
            await asyncio.to_thread(library.import_notes)
        except Exception as e:  # keep watching even if one import fails
            print(f"Inbox import failed: {e}")


log = logging.getLogger("papers")
app = FastAPI(title="Papers", lifespan=lifespan)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"  # pick up UI changes without a hard refresh
    return response


@app.exception_handler(ai.AIError)
def ai_error(_: Request, exc: ai.AIError):
    return JSONResponse({"detail": plain(str(exc)), "technical": str(exc)}, status_code=503)


@app.exception_handler(RequestValidationError)
def bad_request(_: Request, exc: RequestValidationError):
    """A request the page shouldn't have sent (missing or wrong fields): no field names or JSON paths for the reader."""
    log.warning("Bad request: %s", exc.errors())
    return JSONResponse({"detail": "Something was missing from that request. Reload the page and try again.",
                         "technical": str(exc.errors())[:2000]}, status_code=422)


@app.exception_handler(Exception)
def unexpected(_: Request, exc: Exception):
    """A bug: the reader gets a sentence, the terminal gets the traceback."""
    log.exception("Unexpected error")
    return JSONResponse({"detail": "Something went wrong on our side. Try again; if it keeps happening, please report it "
                         "(github.com/hBouanane/papers/issues).", "technical": f"{type(exc).__name__}: {exc}"[:2000]}, status_code=500)


@app.exception_handler(scholar.Busy)
def search_busy(_: Request, exc: scholar.Busy):
    return JSONResponse({"detail": str(exc), "busy": True}, status_code=429)


@app.exception_handler(httpx.HTTPError)
def upstream_error(_: Request, exc: httpx.HTTPError):
    return JSONResponse({"detail": "Couldn't reach the paper databases (Semantic Scholar, OpenAlex, arXiv). Check your "
                         "internet connection and try again.", "technical": str(exc)[:2000]}, status_code=502)


@app.get("/api/health")
def health():
    return {"ok": True}


for router in ROUTERS:
    app.include_router(router)

mimetypes.add_type("text/javascript", ".js")  # the Windows registry can map .js to text/plain
app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")
