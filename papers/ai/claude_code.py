"""A Claude subscription (Pro, Max), through the official Claude Code CLI (`claude -p`) on this computer.

The CLI signs in with the user's own account and usage counts toward their plan. The app only runs the
unmodified CLI, with no tools, and never reads or passes on its credentials.
"""
import json
import os
import re
import subprocess
import tempfile

from papers.ai import providers
from papers.ai.errors import AIError
from papers.ai.streaming import Thinking, as_transcript

NOT_INSTALLED = ("Claude Code isn't installed. Install it (claude.com/claude-code), run `claude` once "
                 "and sign in with your Claude account, then try again.")


def _error(message: str | None) -> AIError:
    message = message or "unknown error"
    if re.search(r"auth|log ?in|oauth|credential", message, re.IGNORECASE):
        return AIError("Claude Code isn't signed in. Open a terminal, run `claude`, type /login and sign in "
                       f"with your Claude account, then try again. ({message})")
    return AIError(f"Claude Code: {message}")


def _system_file(system: str) -> str:
    # Long instructions (they contain the whole paper) go through a file: Windows caps a command
    # line at ~32k characters ([WinError 206]).
    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as f:
        f.write(system)
    return f.name


def _env() -> dict:
    # Without these, Claude Code would bill an API key instead of the subscription.
    return {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}


def _args(binary: str, output: str, effort: str) -> list[str]:
    return [binary, "-p", "--output-format", output, "--tools", "", "--strict-mcp-config",
            "--no-session-persistence", "--model", providers.claude_model(), "--effort", effort]


def run(prompt: str, system: str = "", schema: dict | None = None, effort: str = "medium"):
    """One non-interactive turn with no tools; returns parsed JSON (with a schema) or text."""
    binary = providers.claude_binary()
    if not binary:
        raise AIError(NOT_INSTALLED)
    args = _args(binary, "json", effort)
    system_file = _system_file(system) if system else None
    if system_file:
        args += ["--system-prompt-file", system_file]
    if schema:
        args += ["--json-schema", json.dumps(schema)]
    try:
        done = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              env=_env(), cwd=tempfile.gettempdir(), timeout=900)
    except subprocess.TimeoutExpired as e:
        raise AIError("Claude Code took too long to answer.") from e
    except OSError as e:
        raise AIError(f"Couldn't start Claude Code: {e}") from e
    finally:
        if system_file:
            os.unlink(system_file)
    try:
        out = json.loads(done.stdout)
    except json.JSONDecodeError as e:
        raise AIError(f"Claude Code failed: {(done.stderr or done.stdout).strip()[:300]}") from e
    if out.get("is_error"):
        raise _error(out.get("result"))
    if not schema:
        return out.get("result", "")
    if out.get("structured_output") is not None:
        return out["structured_output"]
    text = out.get("result", "")
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise AIError("Claude Code didn't return the expected format. Try again.") from e


def stream(prompt: str | list[dict], system: str = "", effort: str = "medium"):
    """A turn whose text is passed on piece by piece, as Claude writes it (its thinking as Thinking pieces)."""
    prompt = as_transcript(prompt)
    binary = providers.claude_binary()
    if not binary:
        raise AIError(NOT_INSTALLED)
    args = _args(binary, "stream-json", effort) + ["--verbose", "--include-partial-messages"]
    system_file = _system_file(system) if system else None
    if system_file:
        args += ["--system-prompt-file", system_file]
    try:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", env=_env(), cwd=tempfile.gettempdir())
    except OSError as e:
        if system_file:
            os.unlink(system_file)
        raise AIError(f"Couldn't start Claude Code: {e}") from e
    wrote = False
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
        for line in proc.stdout:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "stream_event":
                e = event.get("event") or {}
                delta = e.get("delta") or {}
                if e.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                    wrote = True
                    yield delta["text"]
                elif e.get("type") == "content_block_delta" and delta.get("type") == "thinking_delta":
                    yield Thinking(delta.get("thinking", ""))
            elif event.get("type") == "result" and event.get("is_error"):
                raise _error(event.get("result"))
        if proc.wait(timeout=60) and not wrote:
            raise AIError(f"Claude Code failed: {proc.stderr.read().strip()[:300]}")
    finally:
        if proc.poll() is None:
            proc.kill()
        if system_file:
            os.unlink(system_file)
