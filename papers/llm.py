"""All Claude calls live here so tests can fake them.

Two ways to reach Claude, chosen in Settings:
- "api": the Anthropic API with ANTHROPIC_API_KEY (pay per use).
- "claude-code": the official Claude Code CLI (`claude -p`) on this machine, signed in with the
  user's own Claude subscription; usage counts against the plan's limits. The app only runs the
  unmodified CLI and never reads or passes on its credentials.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
from typing import Literal

import anthropic
import httpx
from pydantic import BaseModel

from papers import config

MODEL = config.default_model()


def _setting(key: str) -> str:
    from papers import db  # late import: db doesn't depend on llm
    with db.connect() as conn:
        row = conn.execute("select value from settings where key = ?", (key,)).fetchone()
    return (row["value"] if row else "") or ""


# ---------- Providers ----------
# Every provider is chosen the same way. `kind` says how the app talks to it:
#   claude-code / codex: a subscription, through its official CLI signed in with the user's own account
#   api: the Anthropic API;  openai: the OpenAI-compatible chat API that most others (and local servers) speak
PROVIDERS = [
    {"id": "claude-plan", "group": "subscription", "kind": "claude-code", "name": "Claude (Pro, Max)", "base_url": "", "key": False},
    {"id": "chatgpt-plan", "group": "subscription", "kind": "codex", "name": "ChatGPT (Plus, Pro)", "base_url": "", "key": False},
    {"id": "anthropic", "group": "key", "kind": "api", "name": "Anthropic (Claude)", "base_url": "", "key": True},
    {"id": "openai", "group": "key", "kind": "openai", "name": "OpenAI (GPT)", "base_url": "https://api.openai.com/v1", "key": True},
    {"id": "gemini", "group": "key", "kind": "openai", "name": "Google (Gemini)", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "key": True},
    {"id": "mistral", "group": "key", "kind": "openai", "name": "Mistral", "base_url": "https://api.mistral.ai/v1", "key": True},
    {"id": "groq", "group": "key", "kind": "openai", "name": "Groq", "base_url": "https://api.groq.com/openai/v1", "key": True},
    {"id": "openrouter", "group": "key", "kind": "openai", "name": "OpenRouter (hundreds of models)", "base_url": "https://openrouter.ai/api/v1", "key": True},
    {"id": "ollama", "group": "local", "kind": "openai", "name": "Ollama", "base_url": "http://localhost:11434/v1", "key": False},
    {"id": "lmstudio", "group": "local", "kind": "openai", "name": "LM Studio", "base_url": "http://localhost:1234/v1", "key": False},
    {"id": "custom", "group": "other", "kind": "openai", "name": "Any OpenAI-compatible server", "base_url": "", "key": False},
]
BY_ID = {p["id"]: p for p in PROVIDERS}
DEFAULT_FOR_KIND = {"claude-code": "claude-plan", "codex": "chatgpt-plan", "api": "anthropic"}
_TRANSPORT = None  # tests put a fake server here


def backend() -> str:
    """How the chosen provider is reached: 'claude-code', 'codex', 'api' (Anthropic) or 'openai' (compatible API)."""
    return _setting("ai_backend") or os.environ.get("PAPERS_AI", "api")


def provider() -> str:
    """The chosen provider's id (see PROVIDERS)."""
    kind = backend()
    if kind in DEFAULT_FOR_KIND:
        return DEFAULT_FOR_KIND[kind]
    chosen = _setting("ai_provider")
    return chosen if BY_ID.get(chosen, {}).get("kind") == "openai" else "openai"


# Each provider keeps its own key, model and address, so switching back and forth loses nothing.
def provider_setting(name: str, pid: str | None = None) -> str:
    return _setting(f"{name}:{pid or provider()}")


def openai_config() -> dict:
    pid = provider()
    preset = BY_ID[pid]
    env_key = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}.get(pid, "")
    return {"provider": pid, "name": preset["name"], "needs_key": preset["key"],
            "base_url": (provider_setting("ai_base_url", pid) or preset["base_url"]).rstrip("/"),
            "api_key": provider_setting("ai_key", pid) or (os.environ.get(env_key, "") if env_key else ""),
            "model": provider_setting("ai_model", pid)}


def claude_model() -> str:
    return provider_setting("ai_model") or MODEL if backend() in ("claude-code", "api") else MODEL


def _http() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(900, connect=10), transport=_TRANSPORT)


def _openai_headers(cfg: dict) -> dict:
    return {"Authorization": f"Bearer {cfg['api_key']}"} if cfg["api_key"] else {}


def _openai_error(cfg: dict, response: httpx.Response) -> "AIError":
    try:
        detail = response.json().get("error") or {}
        message = detail.get("message") if isinstance(detail, dict) else str(detail)
    except ValueError:
        message = response.text[:300]
    if response.status_code in (401, 403):
        return AIError(f"{cfg['name']} refused the API key. Check it in Settings. ({message})")
    return AIError(f"{cfg['name']} request failed ({response.status_code}): {message}")


def _openai_send(body: dict) -> dict:
    cfg = openai_config()
    if not cfg["base_url"] or not cfg["model"]:
        raise AIError("Choose a model in Settings first.")
    try:
        with _http() as http:
            r = http.post(f"{cfg['base_url']}/chat/completions", json={"model": cfg["model"], **body}, headers=_openai_headers(cfg))
    except httpx.HTTPError as e:
        raise AIError(f"Couldn't reach {cfg['base_url']}. If it's a model on this computer, is it running? ({e})") from e
    if r.status_code >= 400:
        raise _openai_error(cfg, r)
    return r.json()


def _json_in(text: str) -> dict:
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise AIError("The model didn't answer in the expected format. Try again, or choose a stronger model.") from e


def _openai_parse(prompt: str, schema: type[BaseModel], system: str = "") -> BaseModel:
    shape = schema.model_json_schema()
    # Spelled out too, for models and servers that ignore response_format.
    instructions = (f"{system}\n\n" if system else "") + (
        "Reply with only a JSON object (no other text) that matches this JSON Schema:\n" + json.dumps(shape))
    messages = [{"role": "system", "content": instructions}, {"role": "user", "content": prompt}]
    formats = [{"type": "json_schema", "json_schema": {"name": schema.__name__, "schema": shape}}, {"type": "json_object"}, None]
    for i, fmt in enumerate(formats):
        try:
            data = _openai_send({"messages": messages, **({"response_format": fmt} if fmt else {})})
        except AIError as e:
            if i < len(formats) - 1 and ("(400)" in str(e) or "(422)" in str(e)):
                continue  # this server doesn't take that response_format; ask more simply
            raise
        text = data["choices"][0]["message"].get("content") or ""
        try:
            return schema.model_validate(_json_in(text))
        except ValueError as e:
            raise AIError("The model's answer was missing parts. Try again, or choose a stronger model.") from e
    raise AIError("The model couldn't answer in the expected format.")


def _openai_stream(system: str, content: str):
    cfg = openai_config()
    if not cfg["base_url"] or not cfg["model"]:
        raise AIError("Choose a model in Settings first.")
    body = {"model": cfg["model"], "stream": True,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}]}
    try:
        with _http() as http, http.stream("POST", f"{cfg['base_url']}/chat/completions", json=body,
                                          headers=_openai_headers(cfg)) as r:
            if r.status_code >= 400:
                r.read()
                raise _openai_error(cfg, r)
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                choices = json.loads(data).get("choices") or [{}]
                piece = (choices[0].get("delta") or {}).get("content")
                if piece:
                    yield piece
    except httpx.HTTPError as e:
        raise AIError(f"Couldn't reach {cfg['base_url']}. If it's a model on this computer, is it running? ({e})") from e


def list_models() -> list[str]:
    """The models the chosen OpenAI-compatible server offers."""
    cfg = openai_config()
    if not cfg["base_url"]:
        raise AIError("Type the server's address first.")
    try:
        with _http() as http:
            r = http.get(f"{cfg['base_url']}/models", headers=_openai_headers(cfg))
    except httpx.HTTPError as e:
        raise AIError(f"Couldn't reach {cfg['base_url']}. If it's a model on this computer, is it running? ({e})") from e
    if r.status_code >= 400:
        raise _openai_error(cfg, r)
    items = r.json().get("data") or r.json().get("models") or []
    return sorted({(m.get("id") or m.get("name")) if isinstance(m, dict) else str(m) for m in items} - {None})


def ai_name() -> str:
    """How to name the AI in messages: the chosen model, or the provider's name."""
    cfg = openai_config()
    return cfg["model"] or {"claude-code": "Claude", "api": "Claude", "codex": "ChatGPT"}.get(backend(), "the model")


def claude_binary() -> str | None:
    """The Claude Code CLI: PAPERS_CLAUDE_BIN, `claude` on PATH, or the copy the desktop app ships."""
    if found := os.environ.get("PAPERS_CLAUDE_BIN") or shutil.which("claude"):
        return found
    bundled = glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Claude-Data", "*", "claude-code", "*", "*", "claude.exe"))
    return max(bundled, key=os.path.getmtime) if bundled else None


def configured() -> bool:
    if backend() == "openai":
        cfg = openai_config()
        return bool(cfg["base_url"] and cfg["model"] and (cfg["api_key"] or not cfg["needs_key"]))
    if backend() == "claude-code":
        return claude_binary() is not None
    if backend() == "codex":
        return codex_binary() is not None
    return bool(provider_setting("ai_key", "anthropic") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


# ---------- A ChatGPT plan, through the official Codex CLI ----------
def codex_binary() -> str | None:
    return os.environ.get("PAPERS_CODEX_BIN") or shutil.which("codex")


def _strict(schema: dict) -> dict:
    """The JSON Schema form strict structured output wants: every property required, nothing extra."""
    if isinstance(schema, dict):
        schema = {k: _strict(v) for k, v in schema.items() if k not in ("default", "title")}
        if schema.get("type") == "object" and "properties" in schema:
            schema["additionalProperties"] = False
            schema["required"] = list(schema["properties"])
    elif isinstance(schema, list):
        schema = [_strict(v) for v in schema]
    return schema


def _codex(prompt: str, system: str = "", schema: dict | None = None) -> str | dict:
    """One `codex exec` run with no tools that can change anything; the prompt goes in on stdin."""
    binary = codex_binary()
    if not binary:
        raise AIError("Codex isn't installed. Install it (npm install -g @openai/codex), run `codex login` "
                      "and sign in with your ChatGPT account, then try again.")
    work = tempfile.mkdtemp(prefix="papers-codex-")
    out_file = os.path.join(work, "answer.txt")
    args = [binary, "exec", "-", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-o", out_file]
    if model := provider_setting("ai_model", "chatgpt-plan"):
        args += ["--model", model]
    if schema:
        schema_file = os.path.join(work, "schema.json")
        with open(schema_file, "w", encoding="utf-8") as f:
            json.dump(_strict(schema), f)
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
    return _json_in(text) if schema else text.strip()


def _codex_stream(system: str, content: str):
    """Codex gives the answer only once it's complete, so it arrives in one piece."""
    yield _codex(content, system)


def _claude_code_error(message: str | None) -> "AIError":
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


def _subscription_env() -> dict:
    # Without these, Claude Code would bill an API key instead of the subscription.
    return {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}


def _claude_code_stream(prompt: str, system: str = "", effort: str = "medium"):
    """A Claude Code turn whose text is passed on piece by piece, as Claude writes it."""
    binary = claude_binary()
    if not binary:
        raise AIError("Claude Code isn't installed. Install it (claude.com/claude-code), run `claude` once "
                      "and sign in with your Claude account, then try again.")
    args = [binary, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--model", claude_model(), "--effort", effort]
    system_file = _system_file(system) if system else None
    if system_file:
        args += ["--system-prompt-file", system_file]
    try:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", env=_subscription_env(), cwd=tempfile.gettempdir())
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
                if e.get("type") == "content_block_delta" and (e.get("delta") or {}).get("type") == "text_delta":
                    wrote = True
                    yield e["delta"]["text"]
            elif event.get("type") == "result" and event.get("is_error"):
                raise _claude_code_error(event.get("result"))
        if proc.wait(timeout=60) and not wrote:
            raise AIError(f"Claude Code failed: {proc.stderr.read().strip()[:300]}")
    finally:
        if proc.poll() is None:
            proc.kill()
        if system_file:
            os.unlink(system_file)


def _claude_code(prompt: str, system: str = "", schema: dict | None = None, effort: str = "medium"):
    """One non-interactive Claude Code turn with no tools; returns parsed JSON (schema) or text."""
    binary = claude_binary()
    if not binary:
        raise AIError("Claude Code isn't installed. Install it (claude.com/claude-code), run `claude` once "
                      "and sign in with your Claude account, then try again.")
    args = [binary, "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config",
            "--no-session-persistence", "--model", claude_model(), "--effort", effort]
    system_file = _system_file(system) if system else None
    if system_file:
        args += ["--system-prompt-file", system_file]
    if schema:
        args += ["--json-schema", json.dumps(schema)]
    try:
        done = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              env=_subscription_env(), cwd=tempfile.gettempdir(), timeout=900)
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
        raise _claude_code_error(out.get("result"))
    if not schema:
        return out.get("result", "")
    if out.get("structured_output") is not None:
        return out["structured_output"]
    text = out.get("result", "")
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise AIError("Claude Code didn't return the expected format. Try again.") from e


def _client() -> anthropic.Anthropic:
    # A key saved in Settings wins; otherwise the SDK uses ANTHROPIC_API_KEY.
    return anthropic.Anthropic(api_key=provider_setting("ai_key", "anthropic") or None)


class AIError(Exception):
    pass


def _request(method: str, **kwargs):
    try:
        response = getattr(_client().messages, method)(model=claude_model(), max_tokens=16000, **kwargs)
    except TypeError as e:
        raise AIError("Claude is not set up. In Settings, choose your Claude subscription, or set ANTHROPIC_API_KEY and restart.") from e
    except anthropic.APIError as e:
        raise AIError(f"Claude request failed: {e}") from e
    if response.stop_reason == "refusal":
        raise AIError("The model declined this request.")
    return response


def _parse(prompt: str, schema: type[BaseModel], system: str = "", effort: str = "medium") -> BaseModel:
    if backend() == "openai":
        return _openai_parse(prompt, schema, system)
    if backend() == "codex":
        return schema.model_validate(_codex(prompt, system, schema.model_json_schema()))
    if backend() == "claude-code":
        return schema.model_validate(_claude_code(prompt, system, schema.model_json_schema(), effort))
    return _request(
        "parse",
        system=system,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
        output_format=schema,
    ).parsed_output


class Queries(BaseModel):
    queries: list[str]


def search_queries(goal: str) -> list[str]:
    prompt = (
        "A researcher describes what they need to work on. Write 3 short keyword queries "
        f"for an academic paper search engine that together cover it.\n\n<goal>{goal}</goal>"
    )
    return _parse(prompt, Queries, effort="low").queries


# Small (often local) models can't take a whole paper; Settings can cap how much of it is sent.
CONTEXT_CHARS = {"32k": 100_000, "8k": 24_000}


def _paper_context(paper: dict) -> str:
    body = paper.get("text") or f"(Full text unavailable. Abstract only.)\n{paper.get('abstract', '')}"
    limit = CONTEXT_CHARS.get(_setting("ai_context"))
    if limit and len(body) > limit:
        body = body[:limit] + "\n\n[The rest of the paper was shortened to fit the model.]"
    return (
        f"<paper>\n<title>{paper['title']}</title>\n<authors>{paper.get('authors', '')}</authors>\n"
        f"<abstract>{paper.get('abstract', '')}</abstract>\n<full_text>\n{body}\n</full_text>\n</paper>"
    )


class Metadata(BaseModel):
    title: str
    authors: str
    year: int | None


def paper_metadata(head: str) -> dict:
    prompt = (
        f"<first_page>\n{head}\n</first_page>\n\n"
        "This is the start of a research paper's extracted text. Give its exact title, its authors as a "
        "comma-separated list of full names, and its publication year if stated (else null)."
    )
    return _parse(prompt, Metadata, effort="low").model_dump()


class Reference(BaseModel):
    title: str
    authors: str
    year: int | None


class References(BaseModel):
    references: list[Reference]


def extract_references(section: str) -> list[dict]:
    prompt = (
        f"<references_section>\n{section}\n</references_section>\n\n"
        "This is the reference list of a research paper, extracted from its PDF. List every cited work "
        "with its exact title, its authors as a comma-separated list, and its year (null if missing)."
    )
    return [r.model_dump() for r in _parse(prompt, References, effort="low").references]


class Skim(BaseModel):
    tldr: str
    problem: str
    key_idea: str
    contributions: list[str]
    method: str
    results: list[str]
    limitations: list[str]
    figures: list[str]
    questions: list[str]
    reading_plan: list[str]
    relevance: str
    verdict: str


class Word(BaseModel):
    term: str
    kind: Literal["technical", "english"]
    meaning: str
    example: str
    translation: str  # in the reader's language; empty when none is set


class Glossary(BaseModel):
    words: list[Word]


def _translation_rule(language: str) -> str:
    return (f" Also give each one's translation into {language} (a word or short phrase)." if language
            else " Leave translation empty.")


def glossary(paper: dict, language: str = "") -> list[dict]:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "The reader is a researcher whose first language is not English. List the 25 to 40 words and "
        "phrases in this paper most likely to stop them, in the order they first appear. Include both: "
        "technical terms and acronyms (kind 'technical'), and general or academic English words, idioms and "
        "phrasal verbs a non-native speaker may not know, such as 'albeit', 'hence', 'on par with', 'ablation', "
        "'notwithstanding' (kind 'english'). Skip words any intermediate English speaker knows. For each, give "
        "the meaning in simple English (short sentences, everyday words), as it is used in this paper, and a "
        "short quote from the paper where it appears." + _translation_rule(language)
    )
    return [w.model_dump() for w in _parse(prompt, Glossary).words]


def define(paper: dict, term: str, context: str, language: str = "") -> dict:
    """One word or phrase the reader picked, explained as this paper uses it."""
    prompt = (
        f"{_paper_context(paper)}\n\n<term>{term}</term>\n<sentence>{context}</sentence>\n\n"
        "The reader's first language is not English. Explain this word or phrase as it is used here, in simple "
        "English (short sentences, everyday words). Say whether it is a technical term or general English, and "
        "quote the sentence it appears in." + _translation_rule(language)
    )
    return _parse(prompt, Word, effort="low").model_dump()


def skim(paper: dict, goal: str = "") -> dict:
    """A first pass the way Andrew Ng teaches it: title, abstract and figures, then introduction,
    conclusion and section headings, skipping related work and dense math. Written for a reader
    whose first language may not be English, and shaped by what they are working on."""
    prompt = (
        f"{_paper_context(paper)}\n\n"
        + (f"<my_goal>{goal}</my_goal>\n\n" if goal else "")
        + "Give me the first pass on this paper, as Andrew Ng recommends doing it: look at the title, "
        "abstract and figures first, then the introduction, conclusion and section headings; skip related "
        "work and dense math. I may not be a native English speaker, so write in plain, simple English: short "
        "sentences, everyday words, technical terms only when needed (and say what they mean).\n\n"
        "Fill in:\n"
        "- tldr: what the paper does and why it matters, in two or three sentences a newcomer understands.\n"
        "- problem: the problem it tackles and why earlier work falls short.\n"
        "- key_idea: the one idea that makes it work, in one sentence.\n"
        "- contributions: what is new, one sentence each.\n"
        "- method: how it works, in a few sentences, with an intuition rather than equations.\n"
        "- results: the main results, with the actual numbers and what they are compared against.\n"
        "- limitations: weaknesses the authors admit, plus obvious ones they don't.\n"
        "- figures: the figures and tables worth looking at first, each as 'Figure N: what it shows'.\n"
        "- questions: 3 to 5 questions to keep in mind while reading, which the paper answers.\n"
        "- reading_plan: the sections to read, in order, each as 'Section: why, about N minutes'; mark the "
        "ones to read closely and the ones to skip.\n"
        "- relevance: " + ("how this paper helps with my goal, concretely; say so plainly if it doesn't."
                           if goal else "leave empty.") + "\n"
        "- verdict: one line on whether to read it fully, skim it, or skip it, and why."
    )
    return _parse(prompt, Skim).model_dump()


MODES = {
    "explain": "",
    "simplify": ("Rewrite this passage in simple, plain English for a reader whose first language is not English: "
                 "short sentences, common words, the same meaning. Then list up to 5 hard words from it, each with a "
                 "short, simple meaning."),
    "translate": ("Translate this passage into {language}, naturally and faithfully. Keep each technical term in "
                  "English in parentheses after its translation. Then add one or two sentences in {language} on what "
                  "it means in this paper."),
}


def explain(paper: dict, passage: str, question: str = "", mode: str = "explain", language: str = "") -> str:
    return "".join(explain_stream(paper, passage, question, mode=mode, language=language))


def _stream(system: list[dict], content: str, effort: str = "medium"):
    """The API's answer, piece by piece."""
    try:
        with _client().messages.stream(model=claude_model(), max_tokens=16000, system=system, output_config={"effort": effort},
                                       messages=[{"role": "user", "content": content}]) as stream:
            yield from stream.text_stream
            if stream.get_final_message().stop_reason == "refusal":
                raise AIError("The model declined this request.")
    except TypeError as e:
        raise AIError("Claude is not set up. In Settings, choose your Claude subscription, or set ANTHROPIC_API_KEY and restart.") from e
    except anthropic.APIError as e:
        raise AIError(f"Claude request failed: {e}") from e


def explain_stream(paper: dict, passage: str, question: str = "", mode: str = "explain", language: str = ""):
    """The explanation as it is written (an iterator of text pieces)."""
    system = [
        {"type": "text", "text": (
            "You help a researcher understand a paper they are reading. You have the full paper. "
            "When they paste a passage, reformulate it in simpler terms, define jargon, connect it "
            "to the rest of the paper (earlier definitions, the method, the results), and give an "
            "intuition or small example when it helps. When they ask about the paper as a whole, "
            "answer from the paper and say where in it the answer comes from. Keep it short and plain.")},
        {"type": "text", "text": _paper_context(paper), "cache_control": {"type": "ephemeral"}},
    ]
    content = f"<passage>\n{passage}\n</passage>" if passage else ""
    if question:
        content += f"\n\nMy question: {question}" if passage else question
    if MODES.get(mode):  # after the cached paper, so every mode reuses the same cache
        content += "\n\n" + MODES[mode].format(language=language)
    if backend() == "claude-code":
        return _claude_code_stream(content, "\n\n".join(block["text"] for block in system))
    if backend() == "openai":
        return _openai_stream("\n\n".join(block["text"] for block in system), content)
    if backend() == "codex":
        return _codex_stream("\n\n".join(block["text"] for block in system), content)
    return _stream(system, content)


class QuizItem(BaseModel):
    question: str
    answer: str


class Quiz(BaseModel):
    questions: list[QuizItem]


def quiz(paper: dict) -> list[dict]:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "I just finished reading this paper. Write 5 open questions that check real understanding "
        "(the core idea, why the method works, what the results show, limitations, how it relates "
        "to prior work), not trivia. Give a short reference answer for each."
    )
    return [q.model_dump() for q in _parse(prompt, Quiz).questions]


class GradeItem(BaseModel):
    score: float
    feedback: str


class Grades(BaseModel):
    results: list[GradeItem]


def grade(paper: dict, quiz: list[dict], answers: list[str]) -> dict:
    pairs = "\n\n".join(
        f"<item>\n<question>{q['question']}</question>\n<reference>{q['answer']}</reference>\n"
        f"<student_answer>{a}</student_answer>\n</item>"
        for q, a in zip(quiz, answers)
    )
    prompt = (
        f"{_paper_context(paper)}\n\n{pairs}\n\n"
        "Grade each answer against the paper: score 0 to 1 for how well it shows understanding "
        "(wording does not matter), and one or two sentences of feedback that correct or deepen it."
    )
    results = [r.model_dump() for r in _parse(prompt, Grades).results]
    return {"results": results, "score": sum(r["score"] for r in results) / max(len(results), 1)}


class Match(BaseModel):
    paper_id: int
    reason: str


class Matches(BaseModel):
    matches: list[Match]


def recall(idea: str, candidates: list[dict]) -> list[dict]:
    papers = "\n\n".join(
        f"<paper id=\"{c['id']}\">\n<title>{c['title']}</title>\n<abstract>{c['abstract']}</abstract>\n"
        f"<summary>{c.get('skim') or ''}</summary>\n<excerpt>{c.get('snippet') or ''}</excerpt>\n</paper>"
        for c in candidates
    )
    prompt = (
        f"I remember this idea but not which paper I read it in:\n<idea>{idea}</idea>\n\n"
        f"Papers I have read:\n{papers}\n\n"
        "Return the papers that contain this idea, best match first, each with one sentence on "
        "where or how the paper presents it. Return an empty list if none fit."
    )
    return [m.model_dump() for m in _parse(prompt, Matches, effort="low").matches]
