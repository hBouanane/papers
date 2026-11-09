// Reading a streamed answer from the server: one JSON object per line.
//   {"text"}      a piece of the answer          {"thinking"}  a piece of the model's reasoning
//   {"status"}    what it's doing now            {"tool"}      a step of the agent (Phase 3)
//   {"visual"}    a visual it made               {"action"}    something it did, with an undo id
//   {"done"}      finished (may carry ids)       {"error"}     it failed, with a message to show
// Lines with a "type" field ({"type": "text", "text": ...}) are read the same way.
// `signal` (an AbortController's) stops it: the server notices and ends the model's run.

export async function streamEvents(path, json, onEvent, { signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method: "POST", body: JSON.stringify(json), headers: { "Content-Type": "application/json" }, signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = null;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const type = msg.type || ["text", "thinking", "status", "tool", "visual", "action", "done", "error"].find((k) => k in msg);
      if (type === "error") throw Object.assign(new Error(msg.error || "Something went wrong."), { data: msg });
      if (type === "done") finished = msg;
      onEvent(type, msg);
    }
    if (done) {
      if (!finished) throw new Error("The answer was cut off. Try again.");
      return finished;
    }
  }
}
