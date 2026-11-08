"""The web app: the API (papers/routes/), the web pages (papers/static/), and the Inbox watcher.

Run it with `papers` (see cli.py), or for development:
    uvicorn papers.main:app --reload
"""
import asyncio
import mimetypes
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from papers import ai, config, db, index, library
from papers.ingest import import_inbox
from papers.routes import ROUTERS


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
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


app = FastAPI(title="Papers", lifespan=lifespan)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"  # pick up UI changes without a hard refresh
    return response


@app.exception_handler(ai.AIError)
def ai_error(_: Request, exc: ai.AIError):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(httpx.HTTPError)
def upstream_error(_: Request, exc: httpx.HTTPError):
    return JSONResponse({"detail": f"Semantic Scholar request failed: {exc}"}, status_code=502)


@app.get("/api/health")
def health():
    return {"ok": True}


for router in ROUTERS:
    app.include_router(router)

mimetypes.add_type("text/javascript", ".js")  # the Windows registry can map .js to text/plain
app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")
