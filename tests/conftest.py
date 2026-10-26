import httpx
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests must never reach Semantic Scholar, arXiv or PDF hosts; fake what you need."""
    def blocked(*args, **kwargs):
        raise httpx.ConnectError("network disabled in tests")

    monkeypatch.setattr(httpx, "get", blocked)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPERS_DB", str(tmp_path / "test.db"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # never call the real API from tests
    from app.main import app

    with TestClient(app) as c:
        yield c
