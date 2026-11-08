"""What the app asks AI models: one function per task (skim a paper, explain a passage, write a quiz, ...).

Each builds a prompt and, for answers with a fixed shape, a pydantic model for it; `ai.parse` sends it to the
model chosen in Settings (see papers/ai/). To change what the AI writes, change the prompt here.
Tests replace these functions with fakes, so nothing here runs during tests unless a test asks for it.
"""
from typing import Literal

from pydantic import BaseModel

from papers import ai
from papers.ai import AIError  # noqa: F401  (callers catch llm.AIError)


class Queries(BaseModel):
    queries: list[str]


def search_queries(goal: str) -> list[str]:
    prompt = (
        "A researcher describes what they need to work on. Write 3 short keyword queries "
        f"for an academic paper search engine that together cover it.\n\n<goal>{goal}</goal>"
    )
    return ai.parse(prompt, Queries, effort="low").queries


# Small (often local) models can't take a whole paper; Settings can cap how much of it is sent.
CONTEXT_CHARS = {"32k": 100_000, "8k": 24_000}


def _paper_context(paper: dict) -> str:
    body = paper.get("text") or f"(Full text unavailable. Abstract only.)\n{paper.get('abstract', '')}"
    limit = CONTEXT_CHARS.get(ai.setting("ai_context"))
    if limit and len(body) > limit:
        body = body[:limit] + "\n\n[The rest of the paper was shortened to fit the model.]"
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
    return ai.parse(prompt, Metadata, effort="low").model_dump()


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
    return [r.model_dump() for r in ai.parse(prompt, References, effort="low").references]


class Skim(BaseModel):
    tldr: str
    problem: str
    key_idea: str
    contributions: list[str]
    method: str
    results: list[str]
    limitations: list[str]
    figures: list[str]
    questions: list[str]
    reading_plan: list[str]
    relevance: str
    verdict: str


class Word(BaseModel):
    term: str
    kind: Literal["technical", "english"]
    meaning: str
    example: str
    translation: str  # in the reader's language; empty when none is set


class Glossary(BaseModel):
    words: list[Word]


def _translation_rule(language: str) -> str:
    return (f" Also give each one's translation into {language} (a word or short phrase)." if language
            else " Leave translation empty.")


def glossary(paper: dict, language: str = "") -> list[dict]:
    prompt = (
        f"{_paper_context(paper)}\n\n"
        "The reader is a researcher whose first language is not English. List the 25 to 40 words and "
        "phrases in this paper most likely to stop them, in the order they first appear. Include both: "
        "technical terms and acronyms (kind 'technical'), and general or academic English words, idioms and "
        "phrasal verbs a non-native speaker may not know, such as 'albeit', 'hence', 'on par with', 'ablation', "
        "'notwithstanding' (kind 'english'). Skip words any intermediate English speaker knows. For each, give "
        "the meaning in simple English (short sentences, everyday words), as it is used in this paper, and a "
        "short quote from the paper where it appears." + _translation_rule(language)
    )
    return [w.model_dump() for w in ai.parse(prompt, Glossary).words]


def define(paper: dict, term: str, context: str, language: str = "") -> dict:
    """One word or phrase the reader picked, explained as this paper uses it."""
    prompt = (
        f"{_paper_context(paper)}\n\n<term>{term}</term>\n<sentence>{context}</sentence>\n\n"
        "The reader's first language is not English. Explain this word or phrase as it is used here, in simple "
        "English (short sentences, everyday words). Say whether it is a technical term or general English, and "
        "quote the sentence it appears in." + _translation_rule(language)
    )
    return ai.parse(prompt, Word, effort="low").model_dump()


def skim(paper: dict, goal: str = "") -> dict:
    """A first pass the way Andrew Ng teaches it: title, abstract and figures, then introduction,
    conclusion and section headings, skipping related work and dense math. Written for a reader
    whose first language may not be English, and shaped by what they are working on."""
    prompt = (
        f"{_paper_context(paper)}\n\n"
        + (f"<my_goal>{goal}</my_goal>\n\n" if goal else "")
        + "Give me the first pass on this paper, as Andrew Ng recommends doing it: look at the title, "
        "abstract and figures first, then the introduction, conclusion and section headings; skip related "
        "work and dense math. I may not be a native English speaker, so write in plain, simple English: short "
        "sentences, everyday words, technical terms only when needed (and say what they mean).\n\n"
        "Fill in:\n"
        "- tldr: what the paper does and why it matters, in two or three sentences a newcomer understands.\n"
        "- problem: the problem it tackles and why earlier work falls short.\n"
        "- key_idea: the one idea that makes it work, in one sentence.\n"
        "- contributions: what is new, one sentence each.\n"
        "- method: how it works, in a few sentences, with an intuition rather than equations.\n"
        "- results: the main results, with the actual numbers and what they are compared against.\n"
        "- limitations: weaknesses the authors admit, plus obvious ones they don't.\n"
        "- figures: the figures and tables worth looking at first, each as 'Figure N: what it shows'.\n"
        "- questions: 3 to 5 questions to keep in mind while reading, which the paper answers.\n"
        "- reading_plan: the sections to read, in order, each as 'Section: why, about N minutes'; mark the "
        "ones to read closely and the ones to skip.\n"
        "- relevance: " + ("how this paper helps with my goal, concretely; say so plainly if it doesn't."
                           if goal else "leave empty.") + "\n"
        "- verdict: one line on whether to read it fully, skim it, or skip it, and why."
    )
    return ai.parse(prompt, Skim).model_dump()


MODES = {
    "explain": "",
    "simplify": ("Rewrite this passage in simple, plain English for a reader whose first language is not English: "
                 "short sentences, common words, the same meaning. Then list up to 5 hard words from it, each with a "
                 "short, simple meaning."),
    "translate": ("Translate this passage into {language}, naturally and faithfully. Keep each technical term in "
                  "English in parentheses after its translation. Then add one or two sentences in {language} on what "
                  "it means in this paper."),
}


def explain(paper: dict, passage: str, question: str = "", mode: str = "explain", language: str = "") -> str:
    return "".join(explain_stream(paper, passage, question, mode=mode, language=language))


def explain_stream(paper: dict, passage: str, question: str = "", mode: str = "explain", language: str = ""):
    """The explanation as it is written (an iterator of text pieces)."""
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
    if MODES.get(mode):  # after the cached paper, so every mode reuses the same cache
        content += "\n\n" + MODES[mode].format(language=language)
    return ai.stream(system, content)


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
    return [q.model_dump() for q in ai.parse(prompt, Quiz).questions]


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
    results = [r.model_dump() for r in ai.parse(prompt, Grades).results]
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
    return [m.model_dump() for m in ai.parse(prompt, Matches, effort="low").matches]
