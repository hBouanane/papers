import json
import re


class AIError(Exception):
    """Anything that kept the model from answering; the message is shown to the user as is."""


# What went wrong, said for people. Each rule: what the raw message looks like -> what the reader is told.
# The first that matches wins; a message that is already plain is left as it is.
PLAIN = [
    (r"isn't signed in|not signed in",
     None),  # the sign-in messages are already written for people; only their raw tail goes
    (r"usage limit|hit your .{0,20}limit|quota|credit balance|insufficient.{0,10}(funds|credits)|billing",
     "You've reached the AI's usage limit for now{resets}. Try again later, or pick another provider in Settings."),
    (r"\b429\b|rate.?limit|too many requests|overloaded|\b529\b",
     "The AI is busy right now{resets}. Wait a moment and try again."),
    (r"\b40[13]\b|invalid.{0,20}(api.?)?key|incorrect api key|unauthori[sz]ed|authentication|credentials?|permission denied|forbidden",
     "The AI didn't accept the API key. Check the key in Settings › AI model."),
    (r"model.{0,40}(not found|does not exist|not available|unknown)|no such model|\b404\b",
     "That model wasn't found. Pick another one in Settings › AI model (List models shows what's there)."),
    (r"context.{0,20}(length|window|limit)|too many tokens|maximum.{0,20}tokens|prompt is too long|request too large|\b413\b",
     "This paper is too long for the model. In Settings › AI model › More options, send less of the paper, or pick a larger model."),
    (r"timed? ?out|timeout|took too long",
     "The AI took too long to answer. Try again; a smaller question or Quick mode is faster."),
    (r"connect|connection|unreachable|network|getaddrinfo|name resolution|refused|ssl|certificate",
     "Couldn't reach the AI. Check your internet connection, or that the model's app (Ollama, LM Studio) is running."),
    (r"\b5\d\d\b|internal server error|bad gateway|service unavailable",
     "The AI's service is having trouble right now. Try again in a moment."),
]
TECHNICAL = re.compile(r"[{}\[\]<>]|traceback|exception|error:|errno|\bhttps?://|\.py\b|\(\d{3}\)|\b[a-z_]+error\b", re.IGNORECASE)


def plain(message: str) -> str:
    """The message for the reader: what happened and what to do, without codes, JSON or tracebacks.
    The raw message is still kept (logged, and shown under Details) for whoever needs it."""
    text = " ".join(str(message or "").split())
    resets = re.search(r"resets? (?:at )?([0-9][^().,;]{0,30})", text, re.IGNORECASE)
    for pattern, said in PLAIN:
        if re.search(pattern, text, re.IGNORECASE):
            if said is None:  # already plain: drop a raw "(...)" tail
                return re.sub(r"\s*\((?:[^()]*\b(?:error|failed|oauth|401|403|expired)\b[^()]*)\)\s*$", "", text, flags=re.IGNORECASE)
            return said.format(resets=f" (it resets at {resets.group(1).strip()})" if resets else "")
    if text and not TECHNICAL.search(text) and len(text) < 300:
        return text
    return "The AI couldn't answer this time. Try again; if it keeps happening, check Settings › AI model."


def json_in(text: str) -> dict:
    """The JSON object inside a model's text answer (models sometimes wrap it in prose or code fences)."""
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError as e:
        raise AIError("The model didn't answer in the expected format. Try again, or choose a stronger model.") from e
