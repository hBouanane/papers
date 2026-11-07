"""Any OpenAI-compatible model: ChatGPT, Gemini, Mistral, Groq, OpenRouter, or a local one (Ollama, LM Studio)."""
import json

import httpx
import pytest

from app import llm


@pytest.fixture
def openai_like(client, monkeypatch):
    """Settings for an OpenAI-compatible server, and a fake of that server. Returns the requests it got."""
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "custom", "ai_base_url": "http://models.test/v1/",
                                      "ai_api_key": "test-key", "ai_model": "some-model"})
    seen = []
    replies = []

    def handle(request: httpx.Request):
        body = json.loads(request.content) if request.content else None
        seen.append({"url": str(request.url), "auth": request.headers.get("authorization"), "body": body})
        return replies.pop(0)(body) if replies else httpx.Response(500)

    monkeypatch.setattr(llm, "_TRANSPORT", httpx.MockTransport(handle))
    return seen, replies


def answer(text):
    return lambda body: httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": text}}]})


@pytest.mark.llm_plumbing
def test_structured_answers_from_an_openai_compatible_model(openai_like):
    seen, replies = openai_like
    replies.append(answer('```json\n{"queries": ["diffusion models", "score matching"]}\n```'))
    assert llm.search_queries("generative models") == ["diffusion models", "score matching"]
    req = seen[0]
    assert req["url"] == "http://models.test/v1/chat/completions" and req["auth"] == "Bearer test-key"
    assert req["body"]["model"] == "some-model"
    assert req["body"]["response_format"]["type"] == "json_schema"
    assert "JSON" in req["body"]["messages"][0]["content"]  # the schema is also spelled out for models that ignore response_format


@pytest.mark.llm_plumbing
def test_models_without_json_schema_support_get_simpler_requests(openai_like):
    seen, replies = openai_like
    replies += [lambda b: httpx.Response(400, json={"error": {"message": "response_format json_schema is not supported"}}),
                lambda b: httpx.Response(400, json={"error": {"message": "response_format is not supported"}}),
                answer('Sure! {"queries": ["x"]}')]
    assert llm.search_queries("g") == ["x"]
    assert [r["body"].get("response_format", {}).get("type") for r in seen] == ["json_schema", "json_object", None]


@pytest.mark.llm_plumbing
def test_answers_stream_from_an_openai_compatible_model(openai_like):
    seen, replies = openai_like
    chunks = [{"choices": [{"delta": {"content": c}}]} for c in ("It ", "means ", "this.")]
    sse = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    replies.append(lambda body: httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"}))
    assert list(llm.explain_stream({"title": "P", "text": "body"}, "passage")) == ["It ", "means ", "this."]
    assert seen[0]["body"]["stream"] is True


@pytest.mark.llm_plumbing
def test_clear_errors(openai_like, client):
    seen, replies = openai_like
    replies.append(lambda b: httpx.Response(401, json={"error": {"message": "Incorrect API key provided"}}))
    with pytest.raises(llm.AIError, match="key"):
        llm.search_queries("g")

    def down(request):
        raise httpx.ConnectError("refused")

    llm._TRANSPORT = httpx.MockTransport(down)
    with pytest.raises(llm.AIError, match="Couldn't reach http://models.test/v1"):
        llm.search_queries("g")


@pytest.mark.llm_plumbing
def test_list_the_models_a_server_offers(openai_like, client):
    seen, replies = openai_like
    replies.append(lambda b: httpx.Response(200, json={"data": [{"id": "zeta"}, {"id": "alpha"}]}))
    assert client.get("/api/ai/models").json() == {"models": ["alpha", "zeta"]}
    assert seen[0]["url"] == "http://models.test/v1/models"


def test_settings_keep_the_key_secret_and_offer_presets(client):
    s = client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "ollama",
                                          "ai_api_key": "sk-secret", "ai_model": "llama3.1"}).json()
    assert "sk-secret" not in json.dumps(s)
    assert (s["ai_backend"], s["ai_provider"], s["ai_model"], s["ai_key_set"]) == ("openai", "ollama", "llama3.1", True)
    assert s["ai_base_url"] == "http://localhost:11434/v1"  # the preset's address unless one is typed
    assert {"openai", "gemini", "openrouter", "ollama", "lmstudio", "custom"} <= {p["id"] for p in s["providers"]}
    assert s["ai_ready"] is True  # a local model needs no key
    s = client.put("/api/settings", json={"ai_api_key": ""}).json()
    assert s["ai_key_set"] is False


def test_long_papers_are_shortened_for_small_models(client):
    client.put("/api/settings", json={"ai_context": "8k"})
    context = llm._paper_context({"title": "T", "text": "word " * 50000})
    assert len(context) < 40000 and "shortened" in context
    client.put("/api/settings", json={"ai_context": "full"})
    assert len(llm._paper_context({"title": "T", "text": "word " * 50000})) > 250000
