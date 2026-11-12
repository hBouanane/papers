"""The Anthropic API, with a key saved in Settings or ANTHROPIC_API_KEY (pay per use).

The `anthropic` package takes several seconds to import (far longer the first time, before Python has compiled
it), so it's loaded when it's first used, not when the app starts: most starts never talk to this API at all.
"""
from pydantic import BaseModel

from papers.ai import providers
from papers.ai.errors import AIError
from papers.ai.streaming import as_messages

NOT_SET_UP = "Claude is not set up. In Settings, choose your Claude subscription, or set ANTHROPIC_API_KEY and restart."


def sdk():
    """The `anthropic` package, imported on first use."""
    import anthropic
    return anthropic


def __getattr__(name: str):  # `anthropic_api.anthropic` still works, for code and tests that reach for it
    if name == "anthropic":
        return sdk()
    raise AttributeError(name)


def client():
    # A key saved in Settings wins; otherwise the SDK uses ANTHROPIC_API_KEY.
    return sdk().Anthropic(api_key=providers.provider_setting("ai_key", "anthropic") or None)


def request(method: str, **kwargs):
    try:
        response = getattr(client().messages, method)(model=providers.claude_model(), max_tokens=16000, **kwargs)
    except TypeError as e:
        raise AIError(NOT_SET_UP) from e
    except sdk().APIError as e:
        raise AIError(f"Claude request failed: {e}") from e
    if response.stop_reason == "refusal":
        raise AIError("The model declined this request.")
    return response


def parse(prompt: str, schema: type[BaseModel], system: str = "", effort: str = "medium") -> BaseModel:
    return request("parse", system=system, output_config={"effort": effort},
                   messages=[{"role": "user", "content": prompt}], output_format=schema).parsed_output


def stream(system: list[dict], content: str | list[dict], effort: str = "medium"):
    """The answer, piece by piece."""
    try:
        with client().messages.stream(model=providers.claude_model(), max_tokens=16000, system=system,
                                      output_config={"effort": effort},
                                      messages=as_messages(content)) as answer:
            yield from answer.text_stream
            if answer.get_final_message().stop_reason == "refusal":
                raise AIError("The model declined this request.")
    except TypeError as e:
        raise AIError(NOT_SET_UP) from e
    except sdk().APIError as e:
        raise AIError(f"Claude request failed: {e}") from e


def list_models() -> list[str]:
    try:
        return sorted(m.id for m in client().models.list(limit=100))
    except Exception as e:  # the SDK's own errors (no key, refused key)
        raise AIError(f"Couldn't list the models: {e}") from e
