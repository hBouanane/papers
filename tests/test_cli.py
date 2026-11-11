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
    monkeypatch.setattr(cli.shutil, "which", lambda name: None)  # no uv on this computer
    with pytest.raises(SystemExit) as stop:
        cli.check_python([])
    said = capsys.readouterr().out
    assert stop.value.code == 1
    assert "can't start on this Python" in said and "uvx --python 3.13 papers-app" in said


def test_with_uv_it_starts_again_on_a_python_that_works(monkeypatch, capsys):
    real = builtins.__import__

    def broken(name, *args, **kwargs):
        if name == "papers.ai":
            raise TypeError("no")
        return real(name, *args, **kwargs)
    ran = []
    monkeypatch.setattr(builtins, "__import__", broken)
    monkeypatch.setattr(cli.shutil, "which", lambda name: "uvx")
    monkeypatch.setattr(cli.subprocess, "call", lambda cmd, env: ran.append((cmd, env.get("PAPERS_PYTHON_RETRY"))) or 0)
    monkeypatch.delenv("PAPERS_PYTHON_RETRY", raising=False)
    with pytest.raises(SystemExit) as stop:
        cli.check_python(["--port", "9000"])
    assert stop.value.code == 0
    assert ran == [(["uvx", "--python", "3.13", f"papers-app=={cli.__version__}", "--port", "9000"], "1")]
    monkeypatch.setenv("PAPERS_PYTHON_RETRY", "1")  # the second time round it stops instead of looping
    with pytest.raises(SystemExit) as stop:
        cli.check_python([])
    assert stop.value.code == 1 and len(ran) == 1
