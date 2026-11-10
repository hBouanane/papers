"""Where Papers keeps its data, and the environment variables it reads. Everything configurable lives here.

Data (the database, PDFs, figure images) goes in one folder:
- `PAPERS_DATA` if set (the `papers --data` option sets it),
- else the folder of `PAPERS_DB` if set (older setups),
- else the folder chosen when Papers was first set up (or moved in Settings), kept in `config.json`,
- else `./data` when it already holds a library (running from a clone of the repo),
- else the usual place for app data: %APPDATA%\\Papers, ~/Library/Application Support/Papers or ~/.local/share/papers.
"""
import json
import os
import sys
from pathlib import Path


def config_file() -> Path:
    """A small JSON file outside the data folder that says where the data folder is (`PAPERS_CONFIG` overrides)."""
    if env := os.environ.get("PAPERS_CONFIG"):
        return Path(env).expanduser()
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Papers"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "Papers"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "papers"
    return base / "config.json"


_read: dict = {}  # path -> (modified time, values): the database is opened often, the file read only when it changes


def read_config() -> dict:
    path = config_file()
    try:
        mtime = path.stat().st_mtime_ns
        if (hit := _read.get(path)) and hit[0] == mtime:
            return dict(hit[1])
        values = json.loads(path.read_text(encoding="utf-8"))
        _read[path] = (mtime, values if isinstance(values, dict) else {})
        return dict(_read[path][1])
    except (OSError, ValueError):
        return {}


def write_config(**values) -> None:
    """Update config.json (None removes a value)."""
    data = {**read_config(), **values}
    data = {k: v for k, v in data.items() if v is not None}
    path = config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def data_dir_source() -> str:
    """Why the data folder is where it is: "env" (PAPERS_DATA / --data / Docker), "config", "repo" or "default"."""
    if os.environ.get("PAPERS_DATA") or os.environ.get("PAPERS_DB"):
        return "env"
    if read_config().get("data_dir"):
        return "config"
    if Path("data/papers.db").exists():
        return "repo"
    return "default"


def default_data_dir() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Papers"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Papers"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "papers"


def data_dir() -> Path:
    if env := os.environ.get("PAPERS_DATA"):
        return Path(env).expanduser()
    if env := os.environ.get("PAPERS_DB"):
        return Path(env).expanduser().parent
    if chosen := read_config().get("data_dir"):
        return Path(chosen).expanduser()
    if Path("data/papers.db").exists():
        return Path("data")
    return default_data_dir()


def db_path() -> Path:
    if env := os.environ.get("PAPERS_DB"):
        return Path(env).expanduser()
    return data_dir() / "papers.db"


def inbox_poll_seconds() -> float:
    """How often the library folder's Inbox is checked for new PDFs; 0 turns it off."""
    return float(os.environ.get("PAPERS_INBOX_POLL", "10"))


def default_model() -> str:
    """The Claude model used through the Anthropic API unless Settings picks another."""
    return os.environ.get("PAPERS_MODEL", "claude-opus-5-5")


def semantic_scholar_key() -> str:
    return os.environ.get("S2_API_KEY", "")


def anthropic_key_in_env() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


STATIC_DIR = Path(__file__).parent / "static"
