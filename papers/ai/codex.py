"""A ChatGPT subscription (Plus, Pro), through OpenAI's official Codex CLI (`codex exec`), signed in with the
user's own account. It runs read-only with nothing it can change."""
import json
import os
import re
import shutil
import subprocess
import tempfile

from papers.ai import providers
from papers.ai.errors import AIError, json_in
from papers.ai.streaming import as_transcript


def strict(schema: dict) -> dict:
    """The JSON Schema form strict structured output wants: every property required, nothing extra."""
    if isinstance(schema, dict):
        schema = {k: strict(v) for k, v in schema.items() if k not in ("default", "title")}
        if schema.get("type") == "object" and "properties" in schema:
            schema["additionalProperties"] = False
            schema["required"] = list(schema["properties"])
    elif isinstance(schema, list):
        schema = [strict(v) for v in schema]
    return schema


def run(prompt: str, system: str = "", schema: dict | None = None) -> str | dict:
    """One `codex exec` run; the prompt goes in on stdin. Returns parsed JSON (with a schema) or text."""
    binary = providers.codex_binary()
    if not binary:
        raise AIError("Codex isn't installed. Install it (npm install -g @openai/codex), run `codex login` "
                      "and sign in with your ChatGPT account, then try again.")
    work = tempfile.mkdtemp(prefix="papers-codex-")
    out_file = os.path.join(work, "answer.txt")
    args = [binary, "exec", "-", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-o", out_file]
    if model := providers.provider_setting("ai_model", "chatgpt-plan"):
        args += ["--model", model]
    if schema:
        schema_file = os.path.join(work, "schema.json")
        with open(schema_file, "w", encoding="utf-8") as f:
            json.dump(strict(schema), f)
        args += ["--output-schema", schema_file]
    # Codex has no system prompt option; the instructions lead the prompt. Without these variables it
    # uses the ChatGPT sign-in instead of billing an API key.
    env = {k: v for k, v in os.environ.items() if k not in ("OPENAI_API_KEY", "CODEX_API_KEY")}
    try:
        done = subprocess.run(args, input=(f"{system}\n\n---\n\n{prompt}" if system else prompt), capture_output=True,
                              text=True, encoding="utf-8", env=env, cwd=work, timeout=900)
        if done.returncode != 0:
            message = (done.stderr or done.stdout or "").strip()[-400:]
            if re.search(r"log ?in|auth|sign in|credential", message, re.IGNORECASE):
                raise AIError(f"Codex isn't signed in. Open a terminal, run `codex login` and sign in with your ChatGPT account. ({message})")
            raise AIError(f"Codex failed: {message or 'no details'}")
        text = open(out_file, encoding="utf-8").read() if os.path.exists(out_file) else done.stdout
    except subprocess.TimeoutExpired as e:
        raise AIError("Codex took too long to answer.") from e
    except OSError as e:
        raise AIError(f"Couldn't start Codex: {e}") from e
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return json_in(text) if schema else text.strip()


def stream(system: str, content: str | list[dict]):
    """Codex gives the answer only once it's complete, so it arrives in one piece."""
    yield run(as_transcript(content), system)
