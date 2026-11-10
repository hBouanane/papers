"""Where everything is kept: config.json chooses the data folder, Settings shows it and can move it."""
from papers import config, db


def test_config_file_chooses_the_data_folder(tmp_path, monkeypatch):
    monkeypatch.delenv("PAPERS_DB")
    config.write_config(data_dir=str(tmp_path / "lib"))
    assert config.data_dir() == tmp_path / "lib"
    assert config.data_dir_source() == "config"


def test_env_wins_over_the_config_file(tmp_path, monkeypatch):
    config.write_config(data_dir=str(tmp_path / "lib"))
    monkeypatch.setenv("PAPERS_DATA", str(tmp_path / "env"))
    assert config.data_dir() == tmp_path / "env"
    assert config.data_dir_source() == "env"


def test_storage_lists_what_is_kept(client):
    s = client.get("/api/storage").json()
    assert [p["name"] for p in s["parts"]] == ["papers.db", "pdfs/", "figures/"]
    assert s["can_move"] is False  # tests start with PAPERS_DB set, like --data or Docker


def test_moving_the_data_folder_copies_it_and_switches(client, tmp_path, monkeypatch):
    old = tmp_path / "old"
    monkeypatch.delenv("PAPERS_DB")
    config.write_config(data_dir=str(old))
    db.init()
    db.set_setting("name", "Ada")
    (old / "pdfs").mkdir()
    (old / "pdfs" / "1.pdf").write_bytes(b"%PDF-1.4")
    r = client.post("/api/storage/move", json={"path": str(tmp_path / "new")})
    assert r.status_code == 200, r.text
    assert config.data_dir() == (tmp_path / "new").resolve()
    assert db.setting("name") == "Ada"  # the copy is in use now
    assert (tmp_path / "new" / "pdfs" / "1.pdf").exists() and (old / "papers.db").exists()  # the old one is kept


def test_moving_refuses_a_folder_with_a_library(client, tmp_path, monkeypatch):
    monkeypatch.delenv("PAPERS_DB")
    config.write_config(data_dir=str(tmp_path / "old"))
    db.init()
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "papers.db").write_bytes(b"")
    r = client.post("/api/storage/move", json={"path": str(tmp_path / "other")})
    assert r.status_code == 400 and "already has" in r.json()["detail"]
