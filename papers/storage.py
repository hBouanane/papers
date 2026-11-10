"""Where everything is kept, in one place for Settings and the first-run setup: the data folder (database, PDFs,
figure images), where API keys are kept, and the library folder (an optional copy you can browse).

Moving the data folder copies it (the database through SQLite's backup, so it's safe while the app runs), records
the new place in config.json and leaves the old folder as it is. Papers switches to the new one at once.
"""
import shutil
import sqlite3
from pathlib import Path

from papers import config, keys, library

SOURCE = {
    "env": "set when Papers was started (the --data option, PAPERS_DATA, or Docker's /data volume)",
    "config": "chosen by you",
    "repo": "the data folder of this copy of the code",
    "default": "the usual place for app data on this computer",
}


def size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) if path.is_dir() else 0


def summary() -> dict:
    """Everything the Storage section of Settings shows."""
    data = config.data_dir().resolve()
    folder = library.root()
    source = config.data_dir_source()
    return {
        "data_dir": str(data), "data_source": source, "data_source_text": SOURCE[source],
        "can_move": source != "env", "config_file": str(config.config_file()),
        "parts": [
            {"name": "papers.db", "what": "your library: papers, notes, highlights, goals, conversations",
             "bytes": size(config.db_path())},
            {"name": "pdfs/", "what": "the PDF of each paper", "bytes": size(data / "pdfs")},
            {"name": "figures/", "what": "figure images taken from the PDFs", "bytes": size(data / "figures")},
        ],
        "keys_where": keys.where(),
        "library_dir": str(folder) if folder else "",
    }


def move(target: str) -> Path:
    """Copy the data folder to `target` and use it from the next start. Raises ValueError with a plain message."""
    if config.data_dir_source() == "env":
        raise ValueError("The data folder was set when Papers started (--data, PAPERS_DATA or Docker), so change it there.")
    new = Path(target).expanduser()
    if not new.is_absolute():
        raise ValueError("Give a full path, like D:\\Papers or ~/Papers.")
    old = config.data_dir().resolve()
    new = new.resolve()
    if new == old:
        raise ValueError("That is already the data folder.")
    if old in new.parents:
        raise ValueError("Pick a folder outside the current data folder.")
    if (new / "papers.db").exists():
        raise ValueError("That folder already has a Papers library. Pick an empty folder.")
    new.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(config.db_path())
    dst = sqlite3.connect(new / "papers.db")
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    for part in ("pdfs", "figures"):
        if (old / part).is_dir():
            shutil.copytree(old / part, new / part, dirs_exist_ok=True)
    config.write_config(data_dir=str(new))
    return new
