"""The agent's tools for Claude Code (a Claude subscription), as a small MCP server over stdin/stdout.

Claude Code starts it for one answer (`python -m papers.agent.mcp_server --paper 12`), lists the tools, and calls
them; each call runs the same function as the other providers use (tools.py), on the same library (PAPERS_DB).
It speaks just the part of MCP that's needed: initialize, tools/list, tools/call, ping. Nothing listens on the network.
"""
import argparse
import json
import sys

PROTOCOL = "2024-11-05"
MAX_ACTIONS = 5  # changes per answer, as in loop.py


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", type=int, required=True)
    paper_id = parser.parse_args(argv).paper
    from papers.agent import tools  # after argparse: PAPERS_DB is already in the environment

    def reply(rid, result=None, error=None):
        msg = {"jsonrpc": "2.0", "id": rid, **({"error": error} if error else {"result": result})}
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()

    acted = 0  # changes made in this answer (one server runs for one answer)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        method, rid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
        if rid is None:  # a notification (e.g. notifications/initialized): no answer
            continue
        if method == "initialize":
            reply(rid, {"protocolVersion": params.get("protocolVersion") or PROTOCOL, "capabilities": {"tools": {}},
                        "serverInfo": {"name": "papers", "version": "1"}})
        elif method == "tools/list":
            reply(rid, {"tools": [{"name": t["name"], "description": t["description"], "inputSchema": t["schema"]}
                                  for t in tools.specs()]})
        elif method == "tools/call":
            name = params.get("name", "")
            if tools.TOOLS.get(name, {}).get("act") and acted >= MAX_ACTIONS:
                result = tools.Result(f"That's {MAX_ACTIONS} changes in one answer already; ask the reader before doing more.",
                                      "Stopped: too many changes")
            else:
                result = tools.run(name, paper_id, params.get("arguments") or {})
            text = f"[{result.summary}]\n{result.text}" if result.summary else result.text
            if result.data:  # what was changed, for the app's Undo (read back from Claude Code's output)
                acted += 1
                text += f"\n<!--action {json.dumps(result.data)}-->"
            content = [{"type": "text", "text": text}]
            if result.image:
                content.append({"type": "image", "data": result.image_b64(), "mimeType": "image/png"})
            reply(rid, {"content": content, "isError": False})
        elif method == "ping":
            reply(rid, {})
        else:
            reply(rid, error={"code": -32601, "message": f"Unknown method {method}"})


if __name__ == "__main__":
    main()
