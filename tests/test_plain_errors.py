"""Errors said for people: what happened and what to do, never codes, JSON or tracebacks."""
import pytest
from fastapi.testclient import TestClient

from papers import main, scholar
from papers.ai.errors import plain
from papers.routes import papers as paper_routes


def test_a_paper_found_by_its_doi_can_be_uploaded(client, monkeypatch):
    """A PDF that isn't on arXiv but has a DOI: the lookup brings extra facts (a citation count) that aren't columns."""
    found = {"external_id": "abc", "title": "A Paper Not On arXiv", "authors": "A. B", "year": 2021, "abstract": "x",
             "url": "u", "pdf_url": "", "citations": 12, "openalex": "W1"}
    monkeypatch.setattr(scholar, "lookup", lambda identifier: dict(found))
    monkeypatch.setattr(paper_routes, "read_pdf", lambda data: "Some text. doi: 10.1234/abcd.5678")
    r = client.post("/api/papers/upload", files={"file": ("mine.pdf", b"%PDF-1.4 fake", "application/pdf")})
    assert r.status_code == 200 and r.json()["title"] == "A Paper Not On arXiv"


@pytest.mark.parametrize("raw, said", [
    ("Claude Code: You've hit your 5-hour limit · resets 2:20am (Africa/Casablanca)", "usage limit for now (it resets at 2:20am)"),
    ('OpenRouter request failed (401): {"error":{"message":"No auth credentials found","code":401}}', "didn't accept the API key"),
    ("Groq request failed (404): The model `llama-9` does not exist", "That model wasn't found"),
    ("Couldn't reach Ollama: [WinError 10061] No connection could be made", "Couldn't reach the AI"),
    ('Claude request failed: Error code: 400 - {"message": "prompt is too long: 250000 tokens > 200000 maximum"}', "too long for the model"),
    ("Claude Code failed: Traceback (most recent call last): File x.py", "couldn't answer this time"),
    ("Choose a model in Settings first.", "Choose a model in Settings first."),  # already plain: kept
])
def test_errors_are_said_plainly(raw, said):
    assert said in plain(raw)
    assert "{" not in plain(raw) and "Traceback" not in plain(raw)


def test_a_sign_in_message_loses_its_raw_tail():
    raw = "Claude Code isn't signed in. Run `claude` and /login, then try again. (Failed to authenticate: OAuth session expired)"
    assert plain(raw) == "Claude Code isn't signed in. Run `claude` and /login, then try again."


def test_a_bug_or_a_bad_request_gets_a_sentence(client, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("no such column: citations")
    monkeypatch.setattr(paper_routes, "get_paper", broken)
    quiet = TestClient(main.app, raise_server_exceptions=False)
    r = quiet.get("/api/papers/1")
    assert r.status_code == 500 and "Something went wrong" in r.json()["detail"] and "citations" in r.json()["technical"]
    r = quiet.post("/api/papers", json={})  # no title
    assert r.status_code == 422 and r.json()["detail"].startswith("Something was missing")
