"""Choosing the library folder: the system dialog when there is one, else listing folders in the app."""
import subprocess

from app import folders


def test_listing_shows_folders_and_parent(client, tmp_path):
    (tmp_path / "b").mkdir()
    (tmp_path / "A").mkdir()
    (tmp_path / ".hidden").mkdir()
    (tmp_path / "file.pdf").write_bytes(b"x")
    r = client.get("/api/folders", params={"path": str(tmp_path)})
    assert r.status_code == 200
    body = r.json()
    assert body["folders"] == ["A", "b"]
    assert body["parent"] == str(tmp_path.parent)
    assert body["roots"]


def test_listing_a_folder_not_made_yet_starts_at_its_parent(client, tmp_path):
    r = client.get("/api/folders", params={"path": str(tmp_path / "new" / "deeper")})
    assert r.json()["path"] == str(tmp_path)


def test_listing_needs_a_full_path(client):
    assert client.get("/api/folders", params={"path": "relative/path"}).status_code == 400


def test_pick_without_a_dialog_says_501(client, monkeypatch):
    monkeypatch.setenv("PAPERS_NO_DIALOG", "1")
    assert client.post("/api/folders/pick", json={}).status_code == 501


def test_pick_returns_the_chosen_folder(client, monkeypatch, tmp_path):
    monkeypatch.delenv("PAPERS_NO_DIALOG", raising=False)
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=str(tmp_path)))
    assert client.post("/api/folders/pick", json={"start": ""}).json() == {"path": str(tmp_path)}


def test_pick_cancelled_is_empty(monkeypatch):
    monkeypatch.delenv("PAPERS_NO_DIALOG", raising=False)
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=""))
    assert folders.pick() == ""
