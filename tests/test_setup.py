"""The first-run setup in the terminal, driven with typed keys: the answers end up where the app reads them."""
import io

import pytest
from prompt_toolkit.application import create_app_session
from prompt_toolkit.input import create_pipe_input
from prompt_toolkit.output import DummyOutput
from rich.console import Console

from papers import config, db, desktop, keys, setup

DOWN, ENTER = "\x1b[B", "\r"


@pytest.fixture
def typed(monkeypatch, tmp_path):
    """Run the setup with these keystrokes; returns what it printed."""
    monkeypatch.delenv("PAPERS_DB")
    monkeypatch.chdir(tmp_path)  # not the repo, whose data/ folder would add a choice
    monkeypatch.setattr(config, "default_data_dir", lambda: tmp_path / "usual")
    monkeypatch.setattr(setup.Path, "home", classmethod(lambda cls: tmp_path / "home"))  # never the real Documents
    made = []  # never a real desktop icon
    monkeypatch.setattr(desktop, "create_shortcut", lambda port, default_port=8000: made.append(port) or [tmp_path / "Papers.lnk"])
    monkeypatch.setattr(setup, "_made_icons", made, raising=False)

    def run(keystrokes: str) -> str:
        out = io.StringIO()
        with create_pipe_input() as pipe, create_app_session(input=pipe, output=DummyOutput()):
            pipe.send_text(keystrokes)
            setup.run(Console(file=out, width=120))
        return out.getvalue()
    return run


def test_setup_does_not_ask_where_the_data_goes(typed, tmp_path):
    printed = typed(DOWN * 2 + ENTER  # Not now
                    + ENTER           # decide on the AI later
                    + "n" + ENTER)    # no desktop icon
    assert config.data_dir() == (tmp_path / "usual").resolve()
    assert (tmp_path / "usual" / "papers.db").exists()
    assert config.read_config()["setup_done"] is True
    assert db.setting("library_dir") == ""
    assert "Skipped" in printed and "You're set" in printed and "not chosen yet" in printed


def test_setup_puts_your_papers_in_documents(typed, tmp_path):
    typed(ENTER + ENTER + "n" + ENTER)  # the suggested folder, the AI later, no icon
    folder = tmp_path / "home" / "Documents" / "Papers"
    assert db.setting("library_dir") == str(folder) and (folder / "Inbox").is_dir()


def test_setup_asks_again_for_a_folder_it_cannot_use(typed, tmp_path):
    folder = tmp_path / "My Papers"
    printed = typed(DOWN + ENTER                           # Somewhere else…
                    + "papers" + ENTER                     # not a full path
                    + str(tmp_path / "usual") + ENTER      # the app's own data folder
                    + str(folder) + ENTER
                    + ENTER + "n" + ENTER)
    assert "Give a full path" in printed and "keeps its own data" in printed
    assert db.setting("library_dir") == str(folder)


def test_setup_with_an_empty_folder_says_it_skipped(typed):
    printed = typed(DOWN + ENTER + ENTER + ENTER + "n" + ENTER)  # Somewhere else…, nothing typed, the AI later, no icon
    assert db.setting("library_dir") == "" and "Skipped" in printed


def test_setup_saves_the_provider_key_and_model(typed, tmp_path, monkeypatch):
    from papers import ai
    monkeypatch.setattr(ai, "list_models", lambda: [])  # no network: type the model's name
    monkeypatch.setattr(setup, "check_ai", lambda console: None)
    # In the provider list "Decide later" is preselected; Up skips the separators: custom, LM Studio, Ollama, OpenRouter.
    up = "[A"
    typed(DOWN * 2 + ENTER
          + up * 4 + ENTER           # OpenRouter
          + "sk-or-test-1234" + ENTER  # its key
          + "some/model:free" + ENTER
          + "n" + ENTER)             # no desktop icon
    assert db.setting("ai_provider") == "openrouter" and db.setting("ai_model:openrouter") == "some/model:free"
    assert keys.get("ai_key:openrouter") == "sk-or-test-1234"


def test_setup_is_not_asked_outside_a_terminal(monkeypatch):
    monkeypatch.setattr(setup, "interactive", lambda: False)
    assert not setup.needed()


def test_setup_offers_a_desktop_icon(typed, tmp_path):
    printed = typed(DOWN * 2 + ENTER  # no folder
                    + ENTER           # the AI later
                    + ENTER)          # yes, an icon on the desktop
    assert setup._made_icons == [8000] and "Papers.lnk" in printed


def test_setup_can_leave_the_desktop_alone(typed):
    printed = typed(DOWN * 2 + ENTER + ENTER + "n" + ENTER)
    assert setup._made_icons == [] and "papers shortcut" in printed
