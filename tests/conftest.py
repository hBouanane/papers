import httpx
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests must never reach Semantic Scholar, arXiv or PDF hosts; fake what you need."""
    def blocked(*args, **kwargs):
        raise httpx.ConnectError("network disabled in tests")

    monkeypatch.setattr(httpx, "get", blocked)


def pytest_configure(config):
    config.addinivalue_line("markers", "llm_plumbing: tests of the Claude call layer itself (they fake its transport)")


@pytest.fixture(autouse=True)
def no_real_claude(request, monkeypatch):
    """Tests fake the llm functions they need; anything that would reach Claude fails instead."""
    from papers import llm
    if request.node.get_closest_marker("llm_plumbing"):
        return

    def blocked(*args, **kwargs):
        raise llm.AIError("Claude is not available in tests")

    monkeypatch.setattr(llm, "_request", blocked)
    monkeypatch.setattr(llm, "_claude_code", blocked)
    monkeypatch.setattr(llm, "_openai_send", blocked)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPERS_DB", str(tmp_path / "test.db"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # never call the real API from tests
    monkeypatch.setenv("PAPERS_INBOX_POLL", "0")  # tests call import_inbox() themselves
    from papers.main import app

    with TestClient(app) as c:
        yield c
