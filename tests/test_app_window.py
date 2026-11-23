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
    cli.main(["--no-setup", "--port", "8123"])
    assert opened == [desktop.address("127.0.0.1", 8123)]


@pytest.mark.skipif(sys.platform != "win32", reason="a Windows shortcut")
def test_the_desktop_shortcut_starts_papers_in_its_window(tmp_path, monkeypatch):
    monkeypatch.setattr(desktop, "_desktop", lambda: tmp_path)
    [link] = desktop.create_shortcut(9000)
    assert link == tmp_path / "Papers.lnk" and link.stat().st_size > 0


def test_the_shortcut_command_runs_papers_app(monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: "/usr/bin/papers" if name == "papers" else None)
    monkeypatch.setattr(desktop.sys, "platform", "linux")
    assert desktop._launcher(8000, 8000) == ("/usr/bin/papers", [])  # its own window is the default
    assert desktop._launcher(9000, 8000) == ("/usr/bin/papers", ["--port=9000"])
    monkeypatch.setattr(desktop.sys, "platform", "win32")  # on Windows: no console window
    target, args = desktop._launcher(8000, 8000)
    assert target.endswith(("pythonw.exe", "python.exe", "python")) and args == ["-m", "papers"]


def test_papers_stops_only_once_every_window_has_been_closed_for_a_while(monkeypatch):
    import asyncio

    from papers import presence
    clock = [1000.0]
    monkeypatch.setattr(presence.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(presence, "_seen", False)
    monkeypatch.setattr(presence, "_open", 0)
    assert not presence.all_closed()  # no window has opened yet: it may still be opening

    async def a_page_opens_then_closes():
        page = presence.stream()
        await page.__anext__()
        assert presence.pages_open() == 1 and not presence.all_closed()
        await page.aclose()
    asyncio.run(a_page_opens_then_closes())
    assert presence.pages_open() == 0 and not presence.all_closed()  # maybe just a reload
    clock[0] += presence.GRACE
    assert presence.all_closed()


def test_the_page_tells_papers_it_is_open():
    from pathlib import Path
    assert 'new EventSource("/api/app/presence")' in (Path(__file__).parent.parent / "papers/static/js/main.js").read_text(encoding="utf-8")
