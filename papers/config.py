"""Where Papers keeps its data, and the environment variables it reads. Everything configurable lives here.

Data (the database, PDFs, figure images) goes in one folder:
- `PAPERS_DATA` if set (the `papers --data` option sets it),
- else the folder of `PAPERS_DB` if set (older setups),
- else `./data` when it already holds a library (running from a clone of the repo),
- else the usual place for app data: %APPDATA%\\Papers, ~/Library/Application Support/Papers or ~/.local/share/papers.
"""
import os
import sys
from pathlib import Path


def data_dir() -> Path:
    if env := os.environ.get("PAPERS_DATA"):
        return Path(env).expanduser()
    if env := os.environ.get("PAPERS_DB"):
        return Path(env).expanduser().parent
    if Path("data/papers.db").exists():
        return Path("data")
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Papers"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Papers"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "papers"


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
