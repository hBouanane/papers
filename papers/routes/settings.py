"""Settings: your name and language, the AI provider, and the library folder (with the folder picker)."""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from papers import ai, config, db, folders, keys, library, llm, storage
from papers.ai import providers

router = APIRouter(prefix="/api", tags=["settings"])


class SettingsIn(BaseModel):
    library_dir: str | None = None
    ai_backend: Literal["api", "claude-code", "codex", "openai"] | None = None
    ai_provider: str | None = None  # one of ai.PROVIDERS; choosing one also sets ai_backend
    ai_base_url: str | None = None  # empty: the provider's usual address
    ai_api_key: str | None = None  # kept on this computer, never sent back to the page
    ai_model: str | None = None
    ai_context: Literal["full", "32k", "8k"] | None = None
    ai_vision: bool | None = None  # OpenAI-compatible models: send them the figures they look at (Deep mode)
    ai_pages: bool | None = None  # let the AI write interactive pages (run in a sealed frame)
    language: str | None = None  # the reader's first language, for translations
    name: str | None = None  # what the Library greets you with; empty means just "Good morning"


def settings() -> dict:
    """Everything the Settings page shows. API keys never leave the server, only whether one is set."""
    folder = library.root()
    cfg = providers.openai_config()
    return {"library_dir": str(folder) if folder else "", "inbox": str(folder / library.INBOX) if folder else "",
            "suggested": str(Path.home() / "Documents" / "Papers"),
            "ai_backend": providers.backend(), "ai_ready": providers.configured(),
            "claude_binary": providers.claude_binary() or "", "codex_binary": providers.codex_binary() or "",
            "ai_provider": cfg["provider"], "ai_base_url": cfg["base_url"], "ai_model": cfg["model"],
            "ai_key_set": bool(cfg["api_key"]), "ai_context": db.setting("ai_context") or "full",
            "ai_vision": db.setting("ai_vision") == "on", "ai_pages": db.setting("ai_pages") == "on",
            "ai_name": providers.ai_name(), "providers": providers.PROVIDERS,
            "language": db.setting("language"), "name": db.setting("name"),
            "api_key_set": config.anthropic_key_in_env(),
            # which providers have a key saved ("…a1b2"), and where keys are kept, so you never paste one twice
            "keys_saved": {p["id"]: h for p in providers.PROVIDERS if p["key"] and (h := keys.hint(f"ai_key:{p['id']}"))},
            "keys_where": keys.where()}


@router.get("/settings")
def read_settings():
    return settings()


@router.put("/settings")
def save_settings(body: SettingsIn):
    if body.ai_backend:
        db.set_setting("ai_backend", body.ai_backend)
    if body.ai_provider is not None:
        if body.ai_provider not in providers.BY_ID:
            raise HTTPException(422, "Unknown provider")
        db.set_setting("ai_provider", body.ai_provider)
        db.set_setting("ai_backend", providers.BY_ID[body.ai_provider]["kind"])
    if body.ai_context is not None:
        db.set_setting("ai_context", body.ai_context)
    if body.ai_vision is not None:
        db.set_setting("ai_vision", "on" if body.ai_vision else "off")
    if body.ai_pages is not None:
        db.set_setting("ai_pages", "on" if body.ai_pages else "off")
    # Key, model and address belong to the provider that is chosen now.
    current = providers.provider()
    if body.ai_api_key is not None:  # into the system keychain; an empty key forgets it
        keys.put(f"ai_key:{current}", body.ai_api_key)
    for field, key in (("ai_model", "ai_model"), ("ai_base_url", "ai_base_url")):
        if (value := getattr(body, field)) is not None:
            db.set_setting(f"{key}:{current}", value.strip())
    if body.language is not None:
        db.set_setting("language", body.language.strip())
    if body.name is not None:
        db.set_setting("name", body.name.strip()[:60])
    if body.library_dir is not None:
        try:
            library.set_root(body.library_dir)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except OSError as e:
            raise HTTPException(400, f"Couldn't use that folder: {e}")
    return settings()


# ---------- Storage: where everything is kept ----------
class MoveIn(BaseModel):
    path: str


@router.get("/storage")
def read_storage():
    return storage.summary()


@router.post("/storage/move")
def move_storage(body: MoveIn):
    """Copy the data folder somewhere else and use it from now on; the old one is left as it is."""
    try:
        storage.move(body.path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except OSError as e:
        raise HTTPException(400, f"Couldn't copy there: {e}")
    return storage.summary()


# ---------- AI provider ----------
@router.post("/ai/test")
def test_ai():
    """A tiny real request, so the user knows their choice in Settings works."""
    try:
        llm.search_queries("checking the connection")
    except llm.AIError as e:
        return {"ok": False, "message": str(e)}
    p = providers.BY_ID[providers.provider()]
    via = f"your {p['name'].split(' (')[0]} subscription" if p["group"] == "subscription" else p["name"]
    return {"ok": True, "message": f"It works: {providers.ai_name()} answered through {via}."}


@router.get("/ai/models")
def ai_models():
    """The models the chosen provider offers, to pick from in Settings."""
    if providers.backend() in ("claude-code", "codex"):
        raise HTTPException(400, "Subscriptions use their default model; type a model name only if you want another one.")
    try:
        return {"models": ai.list_models()}
    except ai.AIError as e:
        raise HTTPException(400, str(e))


# ---------- Library folder: the app's own folder browser ----------
class NewFolderIn(BaseModel):
    path: str
    name: str


@router.get("/folders")
def list_folders(path: str = ""):
    try:
        return folders.listing(path)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/folders", status_code=201)
def new_folder(body: NewFolderIn):
    try:
        return {"path": folders.make(body.path, body.name)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except OSError as e:
        raise HTTPException(400, f"Couldn't create that folder: {e}")
