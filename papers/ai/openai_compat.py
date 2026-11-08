"""The OpenAI-compatible chat API: OpenAI itself and most others (Gemini, Mistral, Groq, OpenRouter) and local
servers (Ollama, LM Studio). One code path for all of them; the provider only changes the address."""
import json

import httpx
from pydantic import BaseModel

from papers.ai import providers
from papers.ai.errors import AIError, json_in

TRANSPORT = None  # tests put a fake server here


def _http() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(900, connect=10), transport=TRANSPORT)


def _headers(cfg: dict) -> dict:
    return {"Authorization": f"Bearer {cfg['api_key']}"} if cfg["api_key"] else {}


def _unreachable(cfg: dict, e: Exception) -> AIError:
    return AIError(f"Couldn't reach {cfg['base_url']}. If it's a model on this computer, is it running? ({e})")


def _error(cfg: dict, response: httpx.Response) -> AIError:
    try:
        detail = response.json().get("error") or {}
        message = detail.get("message") if isinstance(detail, dict) else str(detail)
    except ValueError:
        message = response.text[:300]
    if response.status_code in (401, 403):
        return AIError(f"{cfg['name']} refused the API key. Check it in Settings. ({message})")
    return AIError(f"{cfg['name']} request failed ({response.status_code}): {message}")


def _ready() -> dict:
    cfg = providers.openai_config()
    if not cfg["base_url"] or not cfg["model"]:
        raise AIError("Choose a model in Settings first.")
    return cfg


def send(body: dict) -> dict:
    """One chat completion request; `body` is everything but the model."""
    cfg = _ready()
    try:
        with _http() as http:
            r = http.post(f"{cfg['base_url']}/chat/completions", json={"model": cfg["model"], **body}, headers=_headers(cfg))
    except httpx.HTTPError as e:
        raise _unreachable(cfg, e) from e
    if r.status_code >= 400:
        raise _error(cfg, r)
    return r.json()


def parse(prompt: str, schema: type[BaseModel], system: str = "") -> BaseModel:
    shape = schema.model_json_schema()
    # Spelled out too, for models and servers that ignore response_format.
    instructions = (f"{system}\n\n" if system else "") + (
        "Reply with only a JSON object (no other text) that matches this JSON Schema:\n" + json.dumps(shape))
    messages = [{"role": "system", "content": instructions}, {"role": "user", "content": prompt}]
    # The strictest format first; servers that refuse it are asked more simply.
    formats = [{"type": "json_schema", "json_schema": {"name": schema.__name__, "schema": shape}}, {"type": "json_object"}, None]
    for i, fmt in enumerate(formats):
        try:
            data = send({"messages": messages, **({"response_format": fmt} if fmt else {})})
        except AIError as e:
            if i < len(formats) - 1 and ("(400)" in str(e) or "(422)" in str(e)):
                continue
            raise
        text = data["choices"][0]["message"].get("content") or ""
        try:
            return schema.model_validate(json_in(text))
        except ValueError as e:
            raise AIError("The model's answer was missing parts. Try again, or choose a stronger model.") from e
    raise AIError("The model couldn't answer in the expected format.")


def stream(system: str, content: str):
    """The answer as it is written, from the server's event stream."""
    cfg = _ready()
    body = {"model": cfg["model"], "stream": True,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}]}
    try:
        with _http() as http, http.stream("POST", f"{cfg['base_url']}/chat/completions", json=body,
                                          headers=_headers(cfg)) as r:
            if r.status_code >= 400:
                r.read()
                raise _error(cfg, r)
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                choices = json.loads(data).get("choices") or [{}]
                if piece := (choices[0].get("delta") or {}).get("content"):
                    yield piece
    except httpx.HTTPError as e:
        raise _unreachable(cfg, e) from e


def list_models() -> list[str]:
    """The models the chosen server offers."""
    cfg = providers.openai_config()
    if not cfg["base_url"]:
        raise AIError("Type the server's address first.")
    try:
        with _http() as http:
            r = http.get(f"{cfg['base_url']}/models", headers=_headers(cfg))
    except httpx.HTTPError as e:
        raise _unreachable(cfg, e) from e
    if r.status_code >= 400:
        raise _error(cfg, r)
    items = r.json().get("data") or r.json().get("models") or []
    return sorted({(m.get("id") or m.get("name")) if isinstance(m, dict) else str(m) for m in items} - {None})
