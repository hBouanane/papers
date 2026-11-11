"""The `papers` command before it starts anything."""
import builtins

import pytest

from papers import cli


def test_an_unsupported_python_gets_one_clear_message(monkeypatch, capsys):
    real = builtins.__import__

    def broken(name, *args, **kwargs):
        if name == "papers.ai":
            raise TypeError("_eval_type() got an unexpected keyword argument 'prefer_fwd_module'")
        return real(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", broken)
    with pytest.raises(SystemExit) as stop:
        cli.check_python()
    said = capsys.readouterr().out
    assert stop.value.code == 1
    assert "can't start on this Python" in said and "uvx --python 3.13 papers-app" in said
