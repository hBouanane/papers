"""Is a Papers page open? Each open page keeps one quiet connection to /api/app/presence; when the last one has been
gone for a while (not just a reload), Papers started by `papers` (in its own window) stops by itself, so closing
the window is all it takes. A server started with --no-browser or --browser never stops this way."""
import asyncio
import threading
import time

GRACE = 10  # seconds with no page open before Papers stops (a reload reconnects within a second or two)
PING = 15  # seconds between the keep-alive comments a page receives

_lock = threading.Lock()
_open = 0
_seen = False  # a page has been open at least once (until then, never stop: the window may still be opening)
_last_closed = time.monotonic()
quit_requested = False  # a newer Papers asked this one to stop (POST /api/app/quit)


def _change(by: int) -> None:
    global _open, _seen, _last_closed
    with _lock:
        _open += by
        if by > 0:
            _seen = True
        elif _open == 0:
            _last_closed = time.monotonic()


def pages_open() -> int:
    return _open


def all_closed(grace: float = GRACE) -> bool:
    """True once a page was open, and none has been for `grace` seconds."""
    with _lock:
        return _seen and _open == 0 and time.monotonic() - _last_closed >= grace


async def stream():
    """The connection an open page keeps: a comment now and then, counted while it lasts."""
    _change(+1)
    try:
        yield ": open\n\n"
        while True:
            await asyncio.sleep(PING)
            yield ": still open\n\n"
    finally:
        _change(-1)
