"""Choosing the library folder in the app's own folder browser: listing folders, shortcuts, making a new one."""


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


def test_listing_has_shortcuts_to_usual_places(client, tmp_path, monkeypatch):
    (tmp_path / "Documents").mkdir()
    monkeypatch.setattr("pathlib.Path.home", classmethod(lambda cls: tmp_path))
    places = client.get("/api/folders", params={"path": str(tmp_path)}).json()["places"]
    names = [p["name"] for p in places]
    assert names[:2] == ["Home", "Documents"]  # Desktop and Downloads don't exist here, so they're left out
    assert len(places) > 2  # then the drives (or /)


def test_listing_a_folder_not_made_yet_starts_at_its_parent(client, tmp_path):
    r = client.get("/api/folders", params={"path": str(tmp_path / "new" / "deeper")})
    assert r.json()["path"] == str(tmp_path)


def test_listing_needs_a_full_path(client):
    assert client.get("/api/folders", params={"path": "relative/path"}).status_code == 400


def test_new_folder(client, tmp_path):
    r = client.post("/api/folders", json={"path": str(tmp_path), "name": "Papers"})
    assert r.status_code == 201
    assert r.json()["path"] == str(tmp_path / "Papers")
    assert (tmp_path / "Papers").is_dir()


def test_new_folder_refuses_bad_or_taken_names(client, tmp_path):
    (tmp_path / "Taken").mkdir()
    for name in ("", "a/b", "what?", "Taken"):
        assert client.post("/api/folders", json={"path": str(tmp_path), "name": name}).status_code == 400
