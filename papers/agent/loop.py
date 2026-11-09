"""Deep mode: the model answers in a loop, using tools (tools.py) to read the paper precisely, look at its figures,
search the reader's library and notes, before (and while) it writes its answer.

`run()` yields what happens, as it happens: str pieces of the answer, Thinking pieces, and Step events (a tool
starting and finishing). Each provider runs the loop its own way:
  OpenAI-compatible (OpenAI, OpenRouter, Ollama, ...)   the chat API's tool calls, streamed
  Anthropic API                                          tool_use blocks, streamed
  Claude subscription (Claude Code)                      Claude Code runs the loop; tools come from mcp_server.py
  ChatGPT subscription (Codex)                           not yet: answered without tools, and it says so
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass

import anthropic
import httpx

from papers import config, llm
from papers.agent import tools
from papers.ai import anthropic_api, claude_code, openai_compat, providers
from papers.ai.errors import AIError
from papers.ai.streaming import Thinking, ThinkTags, as_transcript

MAX_STEPS = 8  # tool calls per answer; then it must answer with what it has
MAX_ACTIONS = 5  # notes, highlights, words and papers added per answer

AGENT = """You can use tools to work precisely, like a careful researcher, before you answer:
- search_paper and read_section: read the exact text instead of relying on memory of it;
- look_at_figure: see a figure or table (with its caption) before you describe it; once you've seen it you can draw
  accurate "look here" boxes on it in a ```figure visual;
- search_library: connect this paper to the reader's other papers when that helps;
- get_notes and get_vocabulary: what the reader noted and is learning, to fit the answer to them.
- save_note, highlight, save_word, add_paper: these change the reader's library. Use them only when the reader asks
  ("note that", "highlight the definition", "add this word", "I want to read that paper") or clearly wants it, and
  say in your answer what you did (they can undo it).
Use a tool when the answer depends on details you should check; don't use tools you don't need. At most
""" + str(MAX_STEPS) + """ tool calls; then answer. Say briefly what you're checking before a tool call only if it helps the reader
follow. Your final answer follows all the rules above."""


@dataclass
class Action:
    """Something the agent did to the library (a note, a highlight, a word, a paper), with what Undo needs."""
    data: dict


@dataclass
class Step:
    id: str
    name: str
    label: str
    state: str  # "start" or "done"
    summary: str = ""
    args: dict | None = None

    def event(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


def _system(paper: dict, figures: list[dict]) -> list[dict]:
    return [
        {"type": "text", "text": llm.tutor() + "\n\n" + AGENT},
        {"type": "text", "text": llm._paper_context(paper) + "\n\n" + llm._figures_list(figures), "cache_control": {"type": "ephemeral"}},
    ]


def _messages(turns: list[dict], language: str) -> list[dict]:
    """The conversation as chat messages (the same as quick mode builds them)."""
    turns = turns[-llm.KEEP_TURNS:]
    while turns and turns[0]["role"] != "user":
        turns = turns[1:]
    out = []
    for i, m in enumerate(turns):
        if m["role"] == "user":
            out.append({"role": "user", "content": llm._turn(m, language, i == len(turns) - 1)})
        else:
            text = m.get("content") or "(no answer)"
            out.append({"role": "assistant", "content": text[:llm.LONG_ANSWER]})
    return out


def run(paper: dict, turns: list[dict], language: str = "", figures: list[dict] | None = None):
    kind = providers.backend()
    system, messages = _system(paper, figures or []), _messages(turns, language)
    if kind == "openai":
        events = _openai(paper, system, messages)
    elif kind == "api":
        events = _anthropic(paper, system, messages)
    elif kind == "claude-code":
        events = _claude_code(paper, system, messages)
    else:  # Codex: no tools yet
        yield Step("note", "note", "Deep mode isn't available with ChatGPT yet: answering without tools", "done")
        events = llm.ai.stream(system, messages)
    # Text written before a tool call ("Let me look at Figure 1.") and the text after it are separate paragraphs.
    wrote, after_tool = False, False
    for e in events:
        if isinstance(e, Step):
            after_tool = after_tool or (wrote and e.state == "done")
        elif isinstance(e, str) and not isinstance(e, Thinking) and e:
            if after_tool:
                yield "\n\n"
                after_tool = False
            wrote = True
        yield e


# ---------- OpenAI-compatible ----------
def _openai(paper: dict, system: list[dict], messages: list[dict]):
    cfg = openai_compat._ready()
    chat = [{"role": "system", "content": "\n\n".join(b["text"] for b in system)}, *messages]
    specs = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["schema"]}}
             for t in tools.specs()]
    vision = tools.setting_vision()
    for step in range(MAX_STEPS + 1):
        body = {"model": cfg["model"], "stream": True, "messages": chat}
        if step < MAX_STEPS:
            body["tools"] = specs
        text, calls, think = [], {}, ThinkTags()
        try:
            with openai_compat._http() as http, http.stream("POST", f"{cfg['base_url']}/chat/completions", json=body,
                                                            headers=openai_compat._headers(cfg)) as r:
                if r.status_code >= 400:
                    r.read()
                    if step == 0 and r.status_code in (400, 404, 422) and "tool" in r.text.lower():
                        raise AIError(f"{cfg['name']} or this model can't use tools, so Deep mode can't work with it. "
                                      "Use Quick, or choose a model that supports tool calling in Settings.")
                    raise openai_compat._error(cfg, r)
                for line in r.iter_lines():
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    delta = ((json.loads(line[5:]).get("choices") or [{}])[0].get("delta")) or {}
                    if thought := delta.get("reasoning") or delta.get("reasoning_content"):
                        yield Thinking(thought)
                    if piece := delta.get("content"):
                        for part in think.feed(piece):
                            if not isinstance(part, Thinking):
                                text.append(part)
                            yield part
                    for tc in delta.get("tool_calls") or []:
                        c = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "arguments": ""})
                        c["id"] = tc.get("id") or c["id"]
                        fn = tc.get("function") or {}
                        c["name"] += fn.get("name") or ""
                        c["arguments"] += fn.get("arguments") or ""
                yield from think.flush()
        except httpx.HTTPError as e:
            raise openai_compat._unreachable(cfg, e) from e
        if not calls:
            return
        ordered = [calls[k] for k in sorted(calls)]
        for c in ordered:
            c["id"] = c["id"] or f"call_{step}_{ordered.index(c)}"
        chat.append({"role": "assistant", "content": "".join(text) or None, "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for c in ordered]})
        images = []
        for c in ordered:
            result = yield from _call(paper, c["id"], c["name"], c["arguments"])
            chat.append({"role": "tool", "tool_call_id": c["id"], "content": result.text})
            if result.image and vision:
                images.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{result.image_b64()}"}})
        if images:
            chat.append({"role": "user", "content": [{"type": "text", "text": "The figures you asked to look at:"}, *images]})


def _call(paper: dict, call_id: str, name: str, arguments: str | dict):
    """Run one tool, announcing it; returns its Result (use with `yield from`)."""
    try:
        args = json.loads(arguments) if isinstance(arguments, str) and arguments.strip() else (arguments or {})
    except ValueError:
        args = {}
    tool = tools.TOOLS.get(name, {})
    label = tool.get("label", name)
    yield Step(call_id, name, label, "start", args=args)
    acted = paper.setdefault("_actions", [0])  # changes made in this answer
    if tool.get("act") and acted[0] >= MAX_ACTIONS:
        result = tools.Result(f"That's {MAX_ACTIONS} changes in one answer already; ask the reader before doing more.",
                              "Stopped: too many changes")
    else:
        result = tools.run(name, paper["id"], args)
        if result.data:
            acted[0] += 1
    yield Step(call_id, name, label, "done", result.summary or label, args=args)
    if result.data:
        yield Action({**result.data, "paper_id": paper["id"]})
    return result


# ---------- Anthropic API ----------
def _anthropic(paper: dict, system: list[dict], messages: list[dict]):
    specs = [{"name": t["name"], "description": t["description"], "input_schema": t["schema"]} for t in tools.specs()]
    chat = list(messages)
    for step in range(MAX_STEPS + 1):
        extra = {"tools": specs} if step < MAX_STEPS else {}
        try:
            with anthropic_api.client().messages.stream(model=providers.claude_model(), max_tokens=16000, system=system,
                                                        messages=chat, **extra) as stream:
                for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield event.delta.text
                    elif event.type == "content_block_delta" and event.delta.type == "thinking_delta":
                        yield Thinking(event.delta.thinking)
                final = stream.get_final_message()
        except TypeError as e:
            raise AIError(anthropic_api.NOT_SET_UP) from e
        except anthropic.APIError as e:
            raise AIError(f"Claude request failed: {e}") from e
        uses = [b for b in final.content if b.type == "tool_use"]
        if final.stop_reason != "tool_use" or not uses:
            return
        chat.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in final.content]})
        results = []
        for b in uses:
            result = yield from _call(paper, b.id, b.name, b.input)
            content = [{"type": "text", "text": result.text}]
            if result.image:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": result.image_b64()}})
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": content})
        chat.append({"role": "user", "content": results})


# ---------- Claude subscription: Claude Code with the tools from mcp_server.py ----------
PREFIX = "mcp__papers__"
ACTION_MARK = re.compile(r"<!--action (\{.*?\})-->")


def _claude_code(paper: dict, system: list[dict], messages: list[dict]):
    binary = providers.claude_binary()
    if not binary:
        raise AIError(claude_code.NOT_INSTALLED)
    work = tempfile.mkdtemp(prefix="papers-agent-")
    mcp_file = os.path.join(work, "mcp.json")
    with open(mcp_file, "w", encoding="utf-8") as f:
        json.dump({"mcpServers": {"papers": {
            "command": sys.executable, "args": ["-m", "papers.agent.mcp_server", "--paper", str(paper["id"])],
            "env": {"PAPERS_DB": str(config.db_path().resolve()), "PYTHONIOENCODING": "utf-8"}}}}, f)
    system_file = claude_code._system_file("\n\n".join(b["text"] for b in system))
    args = [binary, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--tools", "", "--mcp-config", mcp_file, "--strict-mcp-config", "--allowedTools", "mcp__papers",
            "--max-turns", str(MAX_STEPS + 2), "--no-session-persistence", "--model", providers.claude_model(),
            "--system-prompt-file", system_file]
    try:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", env=claude_code._env(), cwd=work)
    except OSError as e:
        raise AIError(f"Couldn't start Claude Code: {e}") from e
    running = {}  # tool_use id → Step that started
    wrote = False
    try:
        proc.stdin.write(as_transcript(messages))
        proc.stdin.close()
        for line in proc.stdout:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = event.get("type")
            if kind == "stream_event":
                e = event.get("event") or {}
                delta = e.get("delta") or {}
                block = e.get("content_block") or {}
                if e.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                    wrote = True
                    yield delta["text"]
                elif e.get("type") == "content_block_delta" and delta.get("type") == "thinking_delta":
                    yield Thinking(delta.get("thinking", ""))
                elif e.get("type") == "content_block_start" and block.get("type") == "tool_use":
                    name = block.get("name", "").removeprefix(PREFIX)
                    step = Step(block.get("id", name), name, tools.TOOLS.get(name, {}).get("label", name), "start")
                    running[step.id] = step
                    yield step
            elif kind == "user":  # tool results come back as the "user" turn
                for b in (event.get("message") or {}).get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") in running:
                        step = running.pop(b["tool_use_id"])
                        text = b.get("content")
                        text = text if isinstance(text, str) else " ".join(x.get("text", "") for x in text or [] if isinstance(x, dict))
                        summary = text.split("\n", 1)[0].strip("[] ") if text.startswith("[") else step.label
                        yield Step(step.id, step.name, step.label, "done", summary)
                        if marker := ACTION_MARK.search(text):  # the MCP server reports what it changed
                            yield Action({**json.loads(marker.group(1)), "paper_id": paper["id"]})
                        wrote = False  # text after a tool call starts a new paragraph
            elif kind == "result" and event.get("is_error"):
                raise claude_code._error(event.get("result"))
        if proc.wait(timeout=60) and not wrote:
            err = proc.stderr.read().strip()[:300]
            if err:
                raise AIError(f"Claude Code failed: {err}")
    finally:
        if proc.poll() is None:
            proc.kill()
        os.unlink(system_file)
