"""Deep mode: the tools, the loop for each provider, the MCP server Claude Code uses, and steps in a conversation."""
import json
import os
import subprocess
import sys
from types import SimpleNamespace

import httpx
import pytest

from papers.agent import loop, tools
from papers.ai import anthropic_api, openai_compat
from papers.ai.streaming import Thinking

TEXT = ("Attention Is All You Need 1 Introduction Recurrent models are slow. 2 Background We build on prior work. "
        "3 Model Architecture The encoder and decoder. 3.1 Encoder and Decoder Stacks The encoder is a stack. "
        "3.5 Positional Encoding Since our model has no recurrence we add sinusoids of different frequencies. "
        "6 We show results here. 4 Why Self-Attention Shorter paths between positions. 5 Training We train on WMT.")


def paper(client, text=TEXT):
    p = client.post("/api/papers", json={"title": "Attention", "abstract": "transformers"}).json()
    from papers.store import update_paper
    update_paper(p["id"], text=text)
    return p


def test_sections_follow_their_numbers():
    found = [(s["number"], s["title"]) for s in tools.sections(TEXT)]
    assert found == [("1", "Introduction"), ("2", "Background"), ("3", "Model Architecture"),
                     ("3.1", "Encoder and Decoder Stacks"), ("3.5", "Positional Encoding"),  # 3.5 after 3.1: allowed (3.2-3.4 not found)
                     ("4", "Why Self-Attention"), ("5", "Training")]


def test_sections_skip_page_numbers_and_running_headers():
    text = "1 I NTRODUCTION We start. 2 Published as a conference paper at ICLR 2 M ETHOD Our method. 3 We show this."
    assert [(s["number"], s["title"]) for s in tools.sections(text)] == [("1", "Introduction"), ("2", "Method")]


def test_read_tools(client):
    p = paper(client)
    found = tools.run("search_paper", p["id"], {"query": "sinusoids frequencies"})
    assert "sinusoids of different frequencies" in found.text and found.summary == "Searched “sinusoids frequencies”"
    long = paper(client, "1 Introduction " + "Filler words here. " * 80 + "3 Method The sinusoids trick. " + "More text. " * 80)
    assert "[§3 Method" in tools.run("search_paper", long["id"], {"query": "sinusoids"}).text
    section = tools.run("read_section", p["id"], {"section": "3.5"})
    assert section.text.startswith("3.5 Positional Encoding") and "Why Self-Attention" not in section.text
    assert tools.run("read_section", p["id"], {"section": "Training"}).summary == "Read §5 Training"
    missing = tools.run("look_at_figure", p["id"], {"number": 9, "kind": "figure"})
    assert "wasn't found" in missing.text and missing.image is None
    assert "no notes" in tools.run("get_notes", p["id"], {}).text
    assert "no tool called" in tools.run("delete_everything", p["id"], {}).text


def sse(*deltas):
    return "".join(f"data: {json.dumps({'choices': [{'delta': d}]})}\n\n" for d in deltas) + "data: [DONE]\n\n"


@pytest.mark.llm_plumbing
def test_openai_compatible_loop_calls_a_tool_then_answers(client, monkeypatch):
    p = paper(client)
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "custom", "ai_base_url": "http://m.test/v1",
                                      "ai_model": "m"})
    replies = [
        sse({"content": "Let me check. "}, {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "read_section", "arguments": '{"sec'}}]},
            {"tool_calls": [{"index": 0, "function": {"arguments": 'tion": "3.5"}'}}]}),
        sse({"reasoning": "now I know"}, {"content": "It adds sinusoids [§3.5]."}),
    ]
    seen = []

    def handle(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, text=replies.pop(0))

    monkeypatch.setattr(openai_compat, "TRANSPORT", httpx.MockTransport(handle))
    events = list(loop.run(client.get(f"/api/papers/{p['id']}").json(), [{"role": "user", "kind": "ask", "content": "How?", "attachments": []}]))
    steps = [e for e in events if isinstance(e, loop.Step)]
    assert [(s.name, s.state) for s in steps] == [("read_section", "start"), ("read_section", "done")]
    assert steps[1].summary == "Read §3.5 Positional Encoding"
    written = "".join(e for e in events if isinstance(e, str) and not isinstance(e, Thinking))
    assert written == "Let me check. \n\nIt adds sinusoids [§3.5]."  # a new paragraph after the tool step
    assert any(isinstance(e, Thinking) for e in events)
    second = seen[1]["messages"]
    assert second[-2]["tool_calls"][0]["function"] == {"name": "read_section", "arguments": '{"section": "3.5"}'}
    assert second[-1]["role"] == "tool" and second[-1]["content"].startswith("3.5 Positional Encoding")
    assert "tools" in seen[0] and seen[0]["tools"][0]["type"] == "function"


@pytest.mark.llm_plumbing
def test_a_model_without_tools_gets_a_clear_message(client, monkeypatch):
    p = paper(client)
    client.put("/api/settings", json={"ai_backend": "openai", "ai_provider": "custom", "ai_base_url": "http://m.test/v1", "ai_model": "m"})
    monkeypatch.setattr(openai_compat, "TRANSPORT", httpx.MockTransport(
        lambda r: httpx.Response(400, json={"error": {"message": "This model does not support tools"}})))
    with pytest.raises(loop.AIError, match="can't use tools"):
        list(loop.run(client.get(f"/api/papers/{p['id']}").json(), [{"role": "user", "kind": "ask", "content": "Q", "attachments": []}]))


@pytest.mark.llm_plumbing
def test_anthropic_loop_sends_tool_results_back(client, monkeypatch):
    p = paper(client)
    client.put("/api/settings", json={"ai_provider": "anthropic"})
    calls = []
    use = SimpleNamespace(type="tool_use", id="t1", name="search_paper", input={"query": "sinusoids"},
                          model_dump=lambda **k: {"type": "tool_use", "id": "t1", "name": "search_paper", "input": {"query": "sinusoids"}})
    finals = [SimpleNamespace(stop_reason="tool_use", content=[use]),
              SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Done.")])]
    texts = [[], ["Done."]]

    class Stream:
        def __init__(self, **kw):
            calls.append(kw)
            self.final, self.text = finals.pop(0), texts.pop(0)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def __iter__(self):
            return iter([SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=t)) for t in self.text])

        def get_final_message(self):
            return self.final

    monkeypatch.setattr(anthropic_api, "client", lambda: SimpleNamespace(messages=SimpleNamespace(stream=Stream)))
    events = list(loop.run(client.get(f"/api/papers/{p['id']}").json(), [{"role": "user", "kind": "ask", "content": "Q", "attachments": []}]))
    assert [e.state for e in events if isinstance(e, loop.Step)] == ["start", "done"]
    assert "Done." in events
    result = calls[1]["messages"][-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "t1" and "Positional Encoding" in result["content"][0]["text"]


def test_mcp_server_lists_and_runs_the_tools(client):
    p = paper(client)
    talk = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "read_section", "arguments": {"section": "3.5"}}}]
    done = subprocess.run([sys.executable, "-m", "papers.agent.mcp_server", "--paper", str(p["id"])],
                          input="\n".join(json.dumps(m) for m in talk) + "\n", capture_output=True, text=True,
                          env={**os.environ, "PAPERS_DB": os.environ["PAPERS_DB"]}, timeout=60)
    replies = [json.loads(line) for line in done.stdout.splitlines()]
    assert [r["id"] for r in replies] == [1, 2, 3]
    assert replies[0]["result"]["protocolVersion"] == "2025-06-18"
    assert {t["name"] for t in replies[1]["result"]["tools"]} >= {"search_paper", "read_section", "look_at_figure"}
    assert replies[2]["result"]["content"][0]["text"].startswith("[Read §3.5 Positional Encoding]\n3.5 Positional Encoding")


def test_deep_messages_stream_their_steps_and_keep_them(client, monkeypatch):
    p = paper(client)

    def fake(paper, turns, language="", figures=None):
        yield loop.Step("1", "read_section", "Reading a section", "start")
        yield loop.Step("1", "read_section", "Reading a section", "done", "Read §3.5 Positional Encoding")
        yield "It adds sinusoids."

    monkeypatch.setattr(loop, "run", fake)
    r = client.post(f"/api/papers/{p['id']}/conversations/start", json={"content": "How?", "depth": "deep"})
    events = [json.loads(line) for line in r.text.splitlines()]
    assert [e["tool"]["state"] for e in events if e["type"] == "tool"] == ["start", "done"]
    done = events[-1]["message"]
    assert done["content"] == "It adds sinusoids." and done["meta"]["steps"] == [{"name": "read_section", "summary": "Read §3.5 Positional Encoding"}]
