"""Plain addresses (/papers/3/read, no "#"), the app's icon, and Papers as a desktop app (its own window, an icon on
the desktop)."""
import sys

import pytest

from papers import cli, desktop


def test_a_page_of_the_app_is_served_at_its_own_address(client):
    page = client.get("/papers/3/read")
    assert page.status_code == 200 and "<title>Papers</title>" in page.text
    assert client.get("/js/missing.js").status_code == 404  # a missing file is still missing
    assert client.get("/api/missing").status_code == 404
    assert client.get("/manifest.webmanifest").headers["content-type"].startswith("application/manifest+json")
    assert client.get("/icons/papers.ico").status_code == 200


def test_papers_has_a_name_of_its_own_on_this_computer():
    if sys.platform != "darwin":
        assert desktop.address("127.0.0.1", 8000) == "http://papers.localhost:8000"
    assert desktop.address("192.168.1.5", 9000) == "http://192.168.1.5:9000"


def test_the_app_window_opens_what_is_already_running(monkeypatch):
    opened = []
    monkeypatch.setattr(cli, "port_free", lambda host, port: False)
    monkeypatch.setattr(cli, "wait_until_up", lambda host, port, patience=120: True)
    monkeypatch.setattr(desktop, "open_window", opened.append)
    monkeypatch.setattr(cli, "python_problem", lambda: None)
    cli.main(["--app", "--no-setup", "--port", "8123"])
    assert opened == [desktop.address("127.0.0.1", 8123)]


@pytest.mark.skipif(sys.platform != "win32", reason="a Windows shortcut")
def test_the_desktop_shortcut_starts_papers_in_its_window(tmp_path, monkeypatch):
    monkeypatch.setattr(desktop, "_desktop", lambda: tmp_path)
    [link] = desktop.create_shortcut(9000)
    assert link == tmp_path / "Papers.lnk" and link.stat().st_size > 0


def test_the_shortcut_command_runs_papers_app(monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: "/usr/bin/papers" if name == "papers" else None)
    assert desktop._launcher(8000, 8000) == ("/usr/bin/papers", ["--app"])
    assert desktop._launcher(9000, 8000) == ("/usr/bin/papers", ["--app", "--port=9000"])
