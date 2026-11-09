"""What the AI writes about a paper: key points (skim), vocabulary, explanations, quizzes and spaced review."""
import json
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from papers import db, index, library, llm
from papers.ai.streaming import Thinking, guarded
from papers.store import get_paper, goal_of, update_paper

router = APIRouter(prefix="/api", tags=["learning"])


@router.post("/papers/{paper_id}/skim")
def skim_paper(paper_id: int):
    paper = get_paper(paper_id)
    result = llm.skim(paper, goal=goal_of(paper))
    status = "skimmed" if paper["status"] == "new" else paper["status"]
    update_paper(paper_id, skim=json.dumps(result), status=status)
    return result


# ---------- Vocabulary ----------
class WordIn(BaseModel):
    term: str = Field(min_length=1, max_length=80)
    context: str = ""


@router.post("/papers/{paper_id}/glossary")
def make_glossary(paper_id: int):
    paper = get_paper(paper_id)
    if not paper["text"]:
        raise HTTPException(400, "This paper has no text yet. Upload its PDF first.")
    words = llm.glossary(paper, language=db.setting("language"))
    update_paper(paper_id, glossary=json.dumps(words))
    return words


@router.post("/papers/{paper_id}/words")
def save_word(paper_id: int, body: WordIn):
    """Add a word the reader picked to this paper's vocabulary (explained in context)."""
    paper = get_paper(paper_id)
    words = paper["glossary"] or []
    if any(w["term"].lower() == body.term.strip().lower() for w in words):
        return words
    word = llm.define(paper, body.term.strip(), body.context.strip(), language=db.setting("language"))
    words = [*words, word]
    update_paper(paper_id, glossary=json.dumps(words))
    return words


# ---------- Explain, simplify, translate, ask ----------
class ExplainIn(BaseModel):
    passage: str = ""
    question: str = ""
    mode: Literal["explain", "simplify", "translate"] = "explain"


def explain_request(paper_id: int, body: ExplainIn) -> tuple[dict, str, str, str]:
    paper = get_paper(paper_id)
    passage, question = body.passage.strip(), body.question.strip()
    if not passage and not question:
        raise HTTPException(400, "Select a passage or ask a question.")
    language = db.setting("language")
    if body.mode == "translate" and not language:
        raise HTTPException(400, "Set your language in Settings first, so Claude knows what to translate into.")
    return paper, passage, question, language


def save_explanation(paper_id: int, passage: str, question: str, answer: str, mode: str) -> None:
    with db.connect() as conn:
        conn.execute("insert into explanations (paper_id, passage, question, answer, mode) values (?, ?, ?, ?, ?)",
                     (paper_id, passage, question, answer, mode))
    index.index_paper(get_paper(paper_id))
    library.sync_paper(paper_id)


@router.post("/papers/{paper_id}/explain")
def explain_passage(paper_id: int, body: ExplainIn):
    paper, passage, question, language = explain_request(paper_id, body)
    answer = llm.explain(paper, passage, question, mode=body.mode, language=language)
    save_explanation(paper_id, passage, question, answer, body.mode)
    return {"explanation": answer}


@router.post("/papers/{paper_id}/explain/stream")
def explain_passage_stream(paper_id: int, body: ExplainIn):
    """The answer as it is written: one JSON object per line, {"text"} pieces then {"done"} or {"error"}."""
    paper, passage, question, language = explain_request(paper_id, body)

    def lines():
        parts = []
        try:
            for piece in guarded(lambda: llm.explain_stream(paper, passage, question, mode=body.mode, language=language)):
                if isinstance(piece, Thinking):
                    yield json.dumps({"thinking": piece}) + "\n"
                    continue
                parts.append(piece)
                yield json.dumps({"text": piece}) + "\n"
        except llm.AIError as e:
            yield json.dumps({"error": str(e)}) + "\n"
            return
        answer = "".join(parts).strip()
        if not answer:  # it only thought, or said nothing: say so, and keep nothing
            yield json.dumps({"error": "No answer came back from the model. Try again, or choose another model in Settings."}) + "\n"
            return
        save_explanation(paper_id, passage, question, answer, body.mode)
        yield json.dumps({"done": True}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/papers/{paper_id}/explanations")
def list_explanations(paper_id: int):
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "select id, passage, question, answer, mode, created_at from explanations where paper_id = ? order by id desc",
            (paper_id,))]


# ---------- Quiz and spaced review ----------
REVIEW_DAYS = [1, 3, 7, 21, 60]  # wait before the next review, by how many reviews went well


class AnswersIn(BaseModel):
    answers: list[str]


class RatingsIn(BaseModel):
    ratings: list[Literal[0, 0.5, 1]]  # missed, partly, got it; one per question


def schedule_review(paper_id: int, score: float) -> dict:
    """Spaced review: good recall waits longer next time, poor recall starts over."""
    step = get_paper(paper_id)["review_step"] or 0
    if score >= 0.7:
        step = min(step + 1, len(REVIEW_DAYS) - 1)
    elif score < 0.4:
        step = 0
    due = date.today() + timedelta(days=REVIEW_DAYS[step])
    return update_paper(paper_id, understanding=score, review_step=step, review_due=due.isoformat())


@router.post("/papers/{paper_id}/quiz")
def make_quiz(paper_id: int):
    paper = get_paper(paper_id)
    questions = llm.quiz(paper)
    update_paper(paper_id, quiz=json.dumps(questions), review_due=paper["review_due"] or date.today().isoformat())
    return questions


@router.post("/papers/{paper_id}/quiz/grade")
def grade_quiz(paper_id: int, body: AnswersIn):
    paper = get_paper(paper_id)
    if not paper["quiz"]:
        raise HTTPException(400, "Generate a quiz first")
    result = llm.grade(paper, paper["quiz"], body.answers)
    schedule_review(paper_id, result["score"])
    return result


@router.post("/papers/{paper_id}/review")
def review_paper(paper_id: int, body: RatingsIn):
    paper = get_paper(paper_id)
    if not paper["quiz"] or len(body.ratings) != len(paper["quiz"]):
        raise HTTPException(400, "Rate every question of this paper's quiz.")
    return schedule_review(paper_id, sum(body.ratings) / len(body.ratings))


@router.get("/reviews/due")
def reviews_due():
    with db.connect() as conn:
        rows = conn.execute(
            "select id, title, authors, year, review_due, quiz from papers"
            " where quiz is not null and review_due <= ? and coalesce(archived, 0) = 0 order by review_due",
            (date.today().isoformat(),)).fetchall()
    return [{**{k: r[k] for k in ("id", "title", "authors", "year", "review_due")}, "questions": len(json.loads(r["quiz"]))}
            for r in rows]
