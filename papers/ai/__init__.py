"""Talking to AI models. The prompts themselves (skim, explain, quiz, ...) are in papers/llm.py; this package
only gets a prompt to the model the user chose in Settings and its answer back.

    providers.py      the list of providers, which one is chosen, its key/model/address, is it ready
    anthropic_api.py  the Anthropic API (an API key)
    claude_code.py    a Claude subscription, through the official Claude Code CLI
    codex.py          a ChatGPT subscription, through the official Codex CLI
    openai_compat.py  everything else: OpenAI, Gemini, Mistral, Groq, OpenRouter, Ollama, LM Studio, ...

To add a provider that speaks the OpenAI chat API, add a line to PROVIDERS. For one that doesn't, add a
module with `parse()` and `stream()` like the others and a branch in the two functions below.
"""
from pydantic import BaseModel

from papers.ai import anthropic_api, claude_code, codex, openai_compat
from papers.ai.errors import AIError
from papers.ai.providers import (
    BY_ID,
    PROVIDERS,
    ai_name,
    backend,
    claude_binary,
    codex_binary,
    configured,
    openai_config,
    provider,
    setting,
)

__all__ = ["AIError", "BY_ID", "PROVIDERS", "ai_name", "backend", "claude_binary", "codex_binary", "configured",
           "list_models", "openai_config", "parse", "provider", "setting", "stream"]


def parse(prompt: str, schema: type[BaseModel], system: str = "", effort: str = "medium") -> BaseModel:
    """Ask the chosen model and get its answer as `schema` (structured output)."""
    kind = backend()
    if kind == "openai":
        return openai_compat.parse(prompt, schema, system)
    if kind == "codex":
        return schema.model_validate(codex.run(prompt, system, schema.model_json_schema()))
    if kind == "claude-code":
        return schema.model_validate(claude_code.run(prompt, system, schema.model_json_schema(), effort))
    return anthropic_api.parse(prompt, schema, system, effort)


def stream(system: list[dict], content: str):
    """The chosen model's answer as it is written (an iterator of text pieces).

    `system` is a list of Anthropic-style text blocks; the paper goes in a cached block so asking
    again about the same paper is cheap with the API. Other backends get the blocks joined."""
    kind = backend()
    joined = "\n\n".join(block["text"] for block in system)
    if kind == "claude-code":
        return claude_code.stream(content, joined)
    if kind == "openai":
        return openai_compat.stream(joined, content)
    if kind == "codex":
        return codex.stream(joined, content)
    return anthropic_api.stream(system, content)


def list_models() -> list[str]:
    """The models the chosen provider offers, to pick from in Settings."""
    if backend() == "api":
        return anthropic_api.list_models()
    return openai_compat.list_models()
