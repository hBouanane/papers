"""Which AI provider is chosen, and its key, model and address.

Every provider is chosen the same way in Settings. `kind` says how the app talks to it:
  claude-code / codex  a subscription, through its official CLI signed in with the user's own account
  api                  the Anthropic API
  openai               the OpenAI-compatible chat API that most others (and local servers) speak
"""
import glob
import os
import shutil

from papers import config, db

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


def setting(key: str) -> str:
    return db.setting(key)


def backend() -> str:
    """How the chosen provider is reached: 'claude-code', 'codex', 'api' (Anthropic) or 'openai' (compatible API)."""
    return setting("ai_backend") or os.environ.get("PAPERS_AI", "api")


def provider() -> str:
    """The chosen provider's id (see PROVIDERS)."""
    kind = backend()
    if kind in DEFAULT_FOR_KIND:
        return DEFAULT_FOR_KIND[kind]
    chosen = setting("ai_provider")
    return chosen if BY_ID.get(chosen, {}).get("kind") == "openai" else "openai"


# Each provider keeps its own key, model and address, so switching back and forth loses nothing.
def provider_setting(name: str, pid: str | None = None) -> str:
    if name == "ai_key":  # API keys live in the system keychain (papers/keys.py)
        from papers import keys
        return keys.get(f"ai_key:{pid or provider()}")
    return setting(f"{name}:{pid or provider()}")


def openai_config() -> dict:
    pid = provider()
    preset = BY_ID[pid]
    env_key = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}.get(pid, "")
    return {"provider": pid, "name": preset["name"], "needs_key": preset["key"],
            "base_url": (provider_setting("ai_base_url", pid) or preset["base_url"]).rstrip("/"),
            "api_key": provider_setting("ai_key", pid) or (os.environ.get(env_key, "") if env_key else ""),
            "model": provider_setting("ai_model", pid)}


def claude_model() -> str:
    default = config.default_model()
    return provider_setting("ai_model") or default if backend() in ("claude-code", "api") else default


def ai_name() -> str:
    """How to name the AI in messages: the chosen model, or the provider's name."""
    return openai_config()["model"] or {"claude-code": "Claude", "api": "Claude", "codex": "ChatGPT"}.get(backend(), "the model")


def claude_binary() -> str | None:
    """The Claude Code CLI: PAPERS_CLAUDE_BIN, `claude` on PATH, or the copy the desktop app ships."""
    if found := os.environ.get("PAPERS_CLAUDE_BIN") or shutil.which("claude"):
        return found
    bundled = glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Claude-Data", "*", "claude-code", "*", "*", "claude.exe"))
    return max(bundled, key=os.path.getmtime) if bundled else None


def codex_binary() -> str | None:
    """The Codex CLI: PAPERS_CODEX_BIN or `codex` on PATH."""
    return os.environ.get("PAPERS_CODEX_BIN") or shutil.which("codex")


def configured() -> bool:
    """Whether the chosen provider has what it needs to answer."""
    kind = backend()
    if kind == "openai":
        cfg = openai_config()
        return bool(cfg["base_url"] and cfg["model"] and (cfg["api_key"] or not cfg["needs_key"]))
    if kind == "claude-code":
        return claude_binary() is not None
    if kind == "codex":
        return codex_binary() is not None
    return bool(provider_setting("ai_key", "anthropic") or config.anthropic_key_in_env())


def describe() -> dict:
    """Which model answers now and through what, for "Written by ..." notes: {model, provider}."""
    pid = provider()
    kind = backend()
    model = claude_model() if kind in ("claude-code", "api") else openai_config()["model"] or ""
    if kind == "codex":
        model = provider_setting("ai_model", "chatgpt-plan") or "ChatGPT (default model)"
    name = BY_ID[pid]["name"].split(" (")[0]
    via = {"claude-plan": "Claude subscription", "chatgpt-plan": "ChatGPT subscription"}.get(pid, name)
    return {"model": model or name, "provider": via}
