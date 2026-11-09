"""Streaming answers safely: telling the model's thinking apart from its answer, and never hanging.

Backends yield plain `str` pieces for the answer and `Thinking` pieces for reasoning (models that think before
answering stream that first, sometimes for a long time). `guarded()` runs any of these streams in a thread, so it
can give up after a silence and stop the model when the reader presses Stop or leaves.
"""
import queue
import threading
from collections.abc import Callable, Iterable, Iterator

from papers.ai.errors import AIError

IDLE_SECONDS = 90  # no word (answer or thinking) for this long: give up, with a message saying so


class Thinking(str):
    """A piece of the model's reasoning, shown folded away from the answer."""


def as_messages(content: str | list[dict]) -> list[dict]:
    """A single question, or a conversation so far ([{role, content}], user first, user last)."""
    return [{"role": "user", "content": content}] if isinstance(content, str) else content


def as_transcript(content: str | list[dict]) -> str:
    """A conversation as one prompt, for backends that take a single message (the subscription CLIs)."""
    messages = as_messages(content)
    if len(messages) == 1:
        return messages[0]["content"]
    earlier = "\n\n".join(f"{'Me' if m['role'] == 'user' else 'You'}: {m['content']}" for m in messages[:-1])
    return f"<conversation_so_far>\n{earlier}\n</conversation_so_far>\n\n{messages[-1]['content']}"


class ThinkTags:
    """Some models (DeepSeek-R1, Qwen3 on Ollama, ...) put their reasoning inside <think>...</think> in the
    answer itself. Feed it the answer's pieces; it yields Thinking for what's inside the tags, str for the rest."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self):
        self.inside = False
        self.pending = ""

    def feed(self, piece: str) -> Iterator[str]:
        text = self.pending + piece
        self.pending = ""
        while text:
            tag = self.CLOSE if self.inside else self.OPEN
            at = text.find(tag)
            if at < 0:
                # keep a possible start of the tag for the next piece
                keep = next((n for n in range(len(tag) - 1, 0, -1) if text.endswith(tag[:n])), 0)
                out, self.pending = (text[:-keep], text[-keep:]) if keep else (text, "")
                if out:
                    yield Thinking(out) if self.inside else out
                return
            if at:
                yield Thinking(text[:at]) if self.inside else text[:at]
            self.inside = not self.inside
            text = text[at + len(tag):]

    def flush(self) -> Iterator[str]:
        if self.pending:
            yield Thinking(self.pending) if self.inside else self.pending
            self.pending = ""


_DONE = object()


def guarded(make: Callable[[], Iterable], idle: float | None = None) -> Iterator:
    """Run the stream `make()` in a thread and pass its pieces on. Raises AIError after `idle` seconds without a
    piece. Closing this generator (Stop, or the reader left) closes the stream too, which ends the model's run."""
    idle = IDLE_SECONDS if idle is None else idle
    pieces: queue.Queue = queue.Queue()
    stop = threading.Event()

    def run():
        stream = None
        try:
            stream = iter(make())
            for piece in stream:
                if stop.is_set():
                    break
                pieces.put(piece)
            pieces.put(_DONE)
        except BaseException as e:  # passed to the reader, raised there
            pieces.put(e)
        finally:
            close = getattr(stream, "close", None)
            if close:
                try:
                    close()
                except Exception:
                    pass

    threading.Thread(target=run, daemon=True).start()
    try:
        while True:
            try:
                piece = pieces.get(timeout=idle)
            except queue.Empty:
                raise AIError(f"The model stopped answering (nothing for {int(idle)} seconds). Try again, or choose a "
                              "faster model in Settings.") from None
            if piece is _DONE:
                return
            if isinstance(piece, BaseException):
                raise piece
            yield piece
    finally:
        stop.set()
