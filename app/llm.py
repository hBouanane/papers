"""All Claude calls live here so tests can fake them."""
import os
from functools import cache

import anthropic
from pydantic import BaseModel

MODEL = os.environ.get("PAPERS_MODEL", "claude-opus-5-5")


@cache
def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def _parse(prompt: str, schema: type[BaseModel], system: str = "", effort: str = "medium") -> BaseModel:
    response = _client().messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=system,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
        output_format=schema,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("The model declined this request.")
    return response.parsed_output


class Queries(BaseModel):
    queries: list[str]


def search_queries(goal: str) -> list[str]:
    prompt = (
        "A researcher describes what they need to work on. Write 3 short keyword queries "
        f"for an academic paper search engine that together cover it.\n\n<goal>{goal}</goal>"
    )
    return _parse(prompt, Queries, effort="low").queries
