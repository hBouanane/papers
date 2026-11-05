"""All Claude calls live here so tests can fake them.

Two ways to reach Claude, chosen in Settings:
- "api": the Anthropic API with ANTHROPIC_API_KEY (pay per use).
- "claude-code": the official Claude Code CLI (`claude -p`) on this machine, signed in with the
  user's own Claude subscription; usage counts against the plan's limits. The app only runs the
  unmodified CLI and never reads or passes on its credentials.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
from functools import cache

import anthropic
from pydantic import BaseModel

MODEL = os.environ.get("PAPERS_MODEL", "claude-opus-5-5")


def backend() -> str:
    from app import db  # late import: db doesn't depend on llm
    with db.connect() as conn:
        row = conn.execute("select value from settings where key = 'ai_backend'").fetchone()
    return (row["value"] if row else None) or os.environ.get("PAPERS_AI", "api")


def claude_binary() -> str | None:
    """The Claude Code CLI: PAPERS_CLAUDE_BIN, `claude` on PATH, or the copy the desktop app ships."""
    if found := os.environ.get("PAPERS_CLAUDE_BIN") or shutil.which("claude"):
        return found
    bundled = glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Claude-Data", "*", "claude-code", "*", "*", "claude.exe"))
    return max(bundled, key=os.path.getmtime) if bundled else None


def configured() -> bool:
    if backend() == "claude-code":
        return claude_binary() is not None
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _claude_code(prompt: str, system: str = "", schema: dict | None = None, effort: str = "medium"):
    """One non-interactive Claude Code turn with no tools; returns parsed JSON (schema) or text."""
    binary = claude_binary()
    if not binary:
        raise AIError("Claude Code isn't installed. Install it (claude.com/claude-code), run `claude` once "
                      "and sign in with your Claude account, then try again.")
    args = [binary, "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config",
            "--no-session-persistence", "--model", MODEL, "--effort", effort]
    if system:
        args += ["--system-prompt", system]
    if schema:
        args += ["--json-schema", json.dumps(schema)]
    # Without these, Claude Code would bill an API key instead of the subscription.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    try:
        done = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              env=env, cwd=tempfile.gettempdir(), timeout=900)
    except subprocess.TimeoutExpired as e:
        raise AIError("Claude Code took too long to answer.") from e
    except OSError as e:
        raise AIError(f"Couldn't start Claude Code: {e}") from e
    try:
        out = json.loads(done.stdout)
    except json.JSONDecodeError as e:
        raise AIError(f"Claude Code failed: {(done.stderr or done.stdout).strip()[:300]}") from e
    if out.get("is_error"):
        message = out.get("result") or "unknown error"
        if re.search(r"auth|log ?in|oauth|credential", message, re.IGNORECASE):
            raise AIError("Claude Code isn't signed in. Open a terminal, run `claude`, type /login and sign in "
                          f"with your Claude account, then try again. ({message})")
        raise AIError(f"Claude Code: {message}")
    if not schema:
        return out.get("result", "")
    if out.get("structured_output") is not None:
        return out["structured_output"]
    text = out.get("result", "")
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise AIError("Claude Code didn't return the expected format. Try again.") from e


@cache
def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


class AIError(Exception):
    pass


def _request(method: str, **kwargs):
    try:
        response = getattr(_client().messages, method)(model=MODEL, max_tokens=16000, **kwargs)
    except TypeError as e:
        raise AIError("Claude is not set up. In Settings, choose your Claude subscription, or set ANTHROPIC_API_KEY and restart.") from e
    except anthropic.APIError as e:
        raise AIError(f"Claude request failed: {e}") from e
    if response.stop_reason == "refusal":
        raise AIError("The model declined this request.")
    return response


def _parse(prompt: str, schema: type[BaseModel], system: str = "", effort: str = "medium") -> BaseModel:
    if backend() == "claude-code":
        return schema.model_validate(_claude_code(prompt, system, schema.model_json_schema(), effort))
    return _request(
        "parse",
        system=system,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
        output_format=schema,
    ).parsed_output


class Queries(BaseModel):
    queries: list[str]


def search_queries(goal: str) -> list[str]:
    prompt = (
        "A researcher describes what they need to work on. Write 3 short keyword queries "
        f"for an academic paper search engine that together cover it.\n\n<goal>{goal}</goal>"
    )
    return _parse(prompt, Queries, effort="low").queries


def _paper_context(paper: dict) -> str:
    body = paper.get("text") or f"(Full text unavailable. Abstract only.)\n{paper.get('abstract', '')}"
    return (
        f"<paper>\n<title>{paper['title']}</title>\n<authors>{paper.get('authors', '')}</authors>\n"
        f"<abstract>{paper.get('abstract', '')}</abstract>\n<full_text>\n{body}\n</full_text>\n</paper>"
    )


class Metadata(BaseModel):
    title: str
    authors: str
    year: int | None


def paper_metadata(head: str) -> dict:
    prompt = (
        f"<first_page>\n{head}\n</first_page>\n\n"
        "This is the start of a research paper's extracted text. Give its exact title, its authors as a "
        "comma-separated list of full names, and its publication year if stated (else null)."
    )
    return _parse(prompt, Metadata, effort="low").model_dump()


class Reference(BaseModel):
    title: str
    authors: str
    year: int | None


class References(BaseModel):
    references: list[Reference]


def extract_references(section: str) -> list[dict]:
    prompt = (
        f"<references_section>\n{section}\n</references_section>\n\n"
        "This is the reference list of a research paper, extracted from its PDF. List every cited work "
        "with its exact title, its authors as a comma-separated list, and its year (null if missing)."
    )
    return [r.model_dump() for r in _parse(prompt, References, effort="low").references]


class Skim(BaseModel):
    problem: str
    contributions: list[str]
    method: str
    results: list[str]
    limitations: list[str]
    read_closely: list[str]
    verdict: str


def skim(paper: dict) -> dict:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "Help me skim this paper the way Andrew Ng recommends: title, abstract, figures, "
        "introduction and conclusion first, skipping related work and dense math. Give me: "
        "the problem it tackles, its key contributions, the method in a few sentences, the key "
        "results, its limitations, which sections deserve a close read, and a one-line verdict "
        "on whether it is worth reading fully. Be concise; each list item is one sentence."
    )
    return _parse(prompt, Skim).model_dump()


def explain(paper: dict, passage: str, question: str = "") -> str:
    system = [
        {"type": "text", "text": (
            "You help a researcher understand a paper they are reading. You have the full paper. "
            "When they paste a passage, reformulate it in simpler terms, define jargon, connect it "
            "to the rest of the paper (earlier definitions, the method, the results), and give an "
            "intuition or small example when it helps. When they ask about the paper as a whole, "
            "answer from the paper and say where in it the answer comes from. Keep it short and plain.")},
        {"type": "text", "text": _paper_context(paper), "cache_control": {"type": "ephemeral"}},
    ]
    content = f"<passage>\n{passage}\n</passage>" if passage else ""
    if question:
        content += f"\n\nMy question: {question}" if passage else question
    if backend() == "claude-code":
        return _claude_code(content, "\n\n".join(block["text"] for block in system))
    response = _request(
        "create",
        system=system,
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": content}],
    )
    return "".join(b.text for b in response.content if b.type == "text")


class QuizItem(BaseModel):
    question: str
    answer: str


class Quiz(BaseModel):
    questions: list[QuizItem]


def quiz(paper: dict) -> list[dict]:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "I just finished reading this paper. Write 5 open questions that check real understanding "
        "(the core idea, why the method works, what the results show, limitations, how it relates "
        "to prior work), not trivia. Give a short reference answer for each."
    )
    return [q.model_dump() for q in _parse(prompt, Quiz).questions]


class GradeItem(BaseModel):
    score: float
    feedback: str


class Grades(BaseModel):
    results: list[GradeItem]


def grade(paper: dict, quiz: list[dict], answers: list[str]) -> dict:
    pairs = "\n\n".join(
        f"<item>\n<question>{q['question']}</question>\n<reference>{q['answer']}</reference>\n"
        f"<student_answer>{a}</student_answer>\n</item>"
        for q, a in zip(quiz, answers)
    )
    prompt = (
        f"{_paper_context(paper)}\n\n{pairs}\n\n"
        "Grade each answer against the paper: score 0 to 1 for how well it shows understanding "
        "(wording does not matter), and one or two sentences of feedback that correct or deepen it."
    )
    results = [r.model_dump() for r in _parse(prompt, Grades).results]
    return {"results": results, "score": sum(r["score"] for r in results) / max(len(results), 1)}


class Match(BaseModel):
    paper_id: int
    reason: str


class Matches(BaseModel):
    matches: list[Match]


def recall(idea: str, candidates: list[dict]) -> list[dict]:
    papers = "\n\n".join(
        f"<paper id=\"{c['id']}\">\n<title>{c['title']}</title>\n<abstract>{c['abstract']}</abstract>\n"
        f"<summary>{c.get('skim') or ''}</summary>\n<excerpt>{c.get('snippet') or ''}</excerpt>\n</paper>"
        for c in candidates
    )
    prompt = (
        f"I remember this idea but not which paper I read it in:\n<idea>{idea}</idea>\n\n"
        f"Papers I have read:\n{papers}\n\n"
        "Return the papers that contain this idea, best match first, each with one sentence on "
        "where or how the paper presents it. Return an empty list if none fit."
    )
    return [m.model_dump() for m in _parse(prompt, Matches, effort="low").matches]
