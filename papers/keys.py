"""API keys and other secrets. They're kept in the system's keychain when there is one (Windows Credential Manager,
macOS Keychain, the Secret Service on Linux): encrypted by the system and tied to your login, not in the app's files.
Where there's none (Docker, a server without a desktop) they stay in the app's database instead, as before.

Keys are never sent back to the page: Settings only learns whether one is saved and its last four characters.
"""
import os

from papers import db

SERVICE = "papers-app"
_backend = None  # resolved once: the keyring module, or False for the database


def _keyring():
    global _backend
    if _backend is None:
        _backend = False
        if os.environ.get("PAPERS_KEYRING", "").lower() not in ("off", "0", "no"):
            try:
                import keyring
                kind = type(keyring.get_keyring()).__module__
                if not any(x in kind for x in ("fail", "null", "chainer")) or _works(keyring):
                    _backend = keyring
            except Exception:  # no keyring installed, or no backend on this system
                _backend = False
    return _backend or None


def _works(keyring) -> bool:
    try:
        keyring.set_password(SERVICE, "_check", "1")
        keyring.delete_password(SERVICE, "_check")
        return True
    except Exception:
        return False


def where() -> str:
    """Where keys are kept, said for people: "Windows Credential Manager", "your Keychain", ..."""
    kr = _keyring()
    if not kr:
        return "the app's database"
    kind = type(kr.get_keyring()).__module__
    return ("Windows Credential Manager" if "Windows" in kind else "your Keychain" if "macOS" in kind
            else "your system keyring")


def get(name: str) -> str:
    if kr := _keyring():
        try:
            if value := kr.get_password(SERVICE, name):
                return value
        except Exception:
            pass
    return db.setting(name)


def put(name: str, value: str) -> None:
    """Save a secret (an empty value removes it)."""
    value = value.strip()
    if kr := _keyring():
        try:
            if value:
                kr.set_password(SERVICE, name, value)
            else:
                try:
                    kr.delete_password(SERVICE, name)
                except Exception:
                    pass
            _clear_db(name)
            return
        except Exception:  # the keychain refused (locked, no access): keep it in the database instead
            pass
    db.set_setting(name, value)


def hint(name: str) -> str:
    """'…a1b2' for a saved key, '' when none: enough to recognise it, not enough to use it."""
    value = get(name)
    return f"…{value[-4:]}" if len(value) > 8 else ("saved" if value else "")


def _clear_db(name: str) -> None:
    with db.connect() as conn:
        conn.execute("delete from settings where key = ?", (name,))


def move_to_keychain() -> int:
    """Keys saved in the database before the keychain was used move there (once a keychain works); returns how many."""
    if not _keyring():
        return 0
    with db.connect() as conn:
        rows = conn.execute("select key, value from settings where key like 'ai_key:%' and value != ''").fetchall()
    moved = 0
    for row in rows:
        try:
            _keyring().set_password(SERVICE, row["key"], row["value"])
            _clear_db(row["key"])
            moved += 1
        except Exception:
            pass
    return moved
