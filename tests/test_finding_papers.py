"""Finding papers for a goal: the classics, the papers the results build on, and saying so when the services are busy."""
import httpx
import pytest

from papers import scholar


def paper(n: int, **more) -> dict:
    return {"external_id": f"{n:040x}", "title": f"Paper {n}", "authors": "", "year": 2020, "abstract": "",
            "url": "", "pdf_url": "", "citations": n, **more}


def test_the_papers_the_results_cite_most_come_first(monkeypatch):
    results = [paper(1), paper(2), paper(3), paper(4)]
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: [dict(p) for p in results])
    classic = f"{99:040x}"  # cited by three results, but no keyword search returned it

    def s2(method, path, params, json=None):
        if params["fields"] == "paperId,references.paperId":
            refs = {1: [classic, f"{2:040x}"], 2: [classic], 3: [classic, f"{2:040x}"], 4: []}
            return [{"paperId": i, "references": [{"paperId": r} for r in refs[int(i, 16)]]} for i in json["ids"]]
        assert json["ids"] == [classic]  # only what the searches missed is looked up
        return [{"paperId": classic, "title": "The Classic", "year": 1990, "authors": [], "citationCount": 5}]
    monkeypatch.setattr(scholar, "_s2", s2)
    found = scholar.gather(["the topic"])
    assert [p["title"] for p in found][:2] == ["The Classic", "Paper 2"]  # cited by 3, then by 2
    assert found[0]["foundation"] is True and found[0]["cited_here"] == 3
    assert [p["title"] for p in found[2:]] == ["Paper 1", "Paper 3", "Paper 4"]  # then search order


def test_a_named_classic_stays_first(monkeypatch):
    monkeypatch.setattr(scholar, "resolve", lambda title: paper(7, title=title))
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: [paper(1), paper(2)])
    monkeypatch.setattr(scholar, "foundations", lambda found, most=10: found)
    found = scholar.gather(["q"], ["Attention Is All You Need"])
    assert found[0]["title"] == "Attention Is All You Need" and found[0]["landmark"] is True


def test_busy_services_are_said_not_shown_as_an_empty_list(monkeypatch):
    def down(q, limit=10):
        raise httpx.HTTPError("429")
    monkeypatch.setattr(scholar, "search", down)
    with pytest.raises(scholar.Busy, match="busy"):
        scholar.gather(["q"])
    monkeypatch.setattr(scholar, "search", lambda q, limit=10: [])  # answered, just nothing: not "busy"
    assert scholar.gather(["q"]) == []


def test_openalex_answers_when_semantic_scholar_finds_nothing(monkeypatch):
    monkeypatch.setattr(scholar, "_get", lambda path, **params: {"data": []})
    monkeypatch.setattr(scholar, "search_openalex", lambda q, limit=10: [paper(5)])
    assert scholar.search("a whole sentence about my goal") == [paper(5)]


def test_openalex_results_read_like_the_others():
    w = {"id": "https://openalex.org/W2626778328", "doi": "https://doi.org/10.48550/arxiv.1706.03762",
         "display_name": "Attention Is All You Need", "publication_year": 2017, "cited_by_count": 151778,
         "authorships": [{"author": {"display_name": "Ashish Vaswani"}}],
         "abstract_inverted_index": {"The": [0], "dominant": [1], "models": [2]},
         "best_oa_location": None, "primary_location": {"landing_page_url": "http://arxiv.org/abs/1706.03762"},
         "referenced_works": ["https://openalex.org/W1"]}
    p = scholar.normalize_openalex(w)
    assert p["external_id"] == "arXiv:1706.03762" and p["pdf_url"] == "https://arxiv.org/pdf/1706.03762"
    assert p["abstract"] == "The dominant models" and p["authors"] == "Ashish Vaswani" and p["openalex_refs"] == ["W1"]


def test_a_goal_sentence_becomes_search_words():
    assert scholar.keywords("I need to catch up on causal inference for observational studies") \
        == "causal inference observational studies"


def test_search_keys_are_kept_and_only_their_end_is_shown(client):
    r = client.put("/api/settings", json={"search_key_semanticscholar": "s2-test-key-abcd"}).json()
    assert r["search_keys"]["semanticscholar"] == "…abcd" and r["search_keys"]["openalex"] == ""
    assert scholar.s2_key() == "s2-test-key-abcd"
    assert client.put("/api/settings", json={"search_key_semanticscholar": ""}).json()["search_keys"]["semanticscholar"] == ""


def test_a_custom_server_can_have_a_key(client):
    client.put("/api/settings", json={"ai_provider": "custom", "ai_api_key": "server-key-wxyz"})
    assert client.get("/api/settings").json()["keys_saved"]["custom"] == "…wxyz"
