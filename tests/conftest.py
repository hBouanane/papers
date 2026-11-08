import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPERS_DB", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c
