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


def test_the_link_waits_for_the_app_to_answer(monkeypatch):
    answers = iter([OSError("refused"), OSError("refused"), "up"])

    class Up:
        status = 200
        __enter__ = lambda self: self
        __exit__ = lambda self, *a: None

    def fake_open(address, timeout):
        got = next(answers)
        if isinstance(got, OSError):
            raise got
        return Up()
    monkeypatch.setattr(cli.urllib.request, "urlopen", fake_open)
    monkeypatch.setattr(cli.time, "sleep", lambda s: None)
    assert cli.wait_until_up("0.0.0.0", 8000) is True
    assert next(answers, "used up") == "used up"  # it asked three times, and stopped at the first answer


def test_starting_does_not_load_the_slow_anthropic_library():
    import subprocess
    import sys
    code = "import sys, papers.main; print('anthropic' in sys.modules)"
    assert subprocess.run([sys.executable, "-c", code], capture_output=True, text=True).stdout.strip() == "False"
