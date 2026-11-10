"""The first-run setup in the terminal, driven with typed keys: the answers end up where the app reads them."""
import io

import pytest
from prompt_toolkit.application import create_app_session
from prompt_toolkit.input import create_pipe_input
from prompt_toolkit.output import DummyOutput
from rich.console import Console

from papers import config, db, keys, setup

DOWN, ENTER = "\x1b[B", "\r"


@pytest.fixture
def typed(monkeypatch, tmp_path):
    """Run the setup with these keystrokes; returns what it printed."""
    monkeypatch.delenv("PAPERS_DB")
    monkeypatch.chdir(tmp_path)  # not the repo, whose data/ folder would add a choice
    monkeypatch.setattr(config, "default_data_dir", lambda: tmp_path / "usual")
    monkeypatch.setattr(setup.Path, "home", classmethod(lambda cls: tmp_path / "home"))  # never the real Documents

    def run(keystrokes: str) -> str:
        out = io.StringIO()
        with create_pipe_input() as pipe, create_app_session(input=pipe, output=DummyOutput()):
            pipe.send_text(keystrokes)
            setup.run(Console(file=out, width=120))
        return out.getvalue()
    return run


def test_setup_keeps_the_library_where_you_say(typed, tmp_path):
    folder = tmp_path / "My Papers"
    printed = typed(DOWN * 2 + ENTER + str(folder) + ENTER  # Somewhere else…, then the path
                    + ENTER                                 # no browsable copy
                    + ENTER)                                # decide on the AI later
    assert config.data_dir() == folder.resolve()
    assert (folder / "papers.db").exists()
    assert config.read_config()["setup_done"] is True
    assert "You're set" in printed and "not chosen yet" in printed


def test_setup_saves_the_provider_key_and_model(typed, tmp_path, monkeypatch):
    from papers import ai
    monkeypatch.setattr(ai, "list_models", lambda: [])  # no network: type the model's name
    monkeypatch.setattr(setup, "check_ai", lambda console: None)
    # In the provider list "Decide later" is preselected; Up skips the separators: custom, LM Studio, Ollama, OpenRouter.
    up = "\x1b[A"
    typed(DOWN * 2 + ENTER + str(tmp_path / "lib") + ENTER + ENTER
          + up * 4 + ENTER           # OpenRouter
          + "sk-or-test-1234" + ENTER  # its key
          + "some/model:free" + ENTER)
    assert db.setting("ai_provider") == "openrouter" and db.setting("ai_model:openrouter") == "some/model:free"
    assert keys.get("ai_key:openrouter") == "sk-or-test-1234"


def test_setup_is_not_asked_outside_a_terminal(monkeypatch):
    monkeypatch.setattr(setup, "interactive", lambda: False)
    assert not setup.needed()
