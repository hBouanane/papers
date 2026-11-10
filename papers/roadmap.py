"""A reading roadmap for a goal: the best papers for it, in the order to read them.

1. Search widely (the AI's queries for the goal, plus a search for surveys) and gather candidates.
2. The AI picks the best few and orders them in stages (the basics first, then the core, then the newest work), with
   a sentence on why each one and about how long it takes. Without an AI, the most cited results are suggested.
3. You tick the ones you want (all, by default, except those already in your library) and they're added to the goal;
   their PDFs download in the background, then the AI prepares each one as usual.

The roadmap is kept with the goal (settings key `roadmap:<goal id>`), so the goal page shows it with your progress.
"""
import json
import time

from pydantic import BaseModel

from papers import ai, db, llm, pdf, scholar
from papers.store import find_existing, get_paper, insert_paper, save_pdf, update_paper


class Pick(BaseModel):
    number: int  # the candidate's number in the list
    reason: str  # why read it, and why at this point
    minutes: int  # about how long a careful first read takes


class Stage(BaseModel):
    title: str  # e.g. "The basics"
    why: str
    papers: list[Pick]


class Plan(BaseModel):
    intro: str  # two sentences: the path through the topic
    stages: list[Stage]


def _key(topic_id: int) -> str:
    return f"roadmap:{topic_id}"


def saved(topic_id: int) -> dict | None:
    raw = db.setting(_key(topic_id))
    if not raw:
        return None
    plan = json.loads(raw)
    # How far along you are: each added paper's reading status, read fresh.
    with db.connect() as conn:
        status = {r["id"]: r["status"] for r in conn.execute("select id, status from papers")}
    for item in [i for s in plan["stages"] for i in s["items"]] + plan.get("others", []):
        if item.get("paper_id") and item["paper_id"] not in status:
            item["paper_id"] = None  # deleted since
        item["status"] = status.get(item.get("paper_id"), "")
    return plan


def _save(topic_id: int, plan: dict) -> None:
    for item in [i for s in plan["stages"] for i in s["items"]] + plan.get("others", []):
        item.pop("status", None)
    db.set_setting(_key(topic_id), json.dumps(plan))


def candidates(goal: str) -> list[dict]:
    try:
        queries = llm.search_queries(goal)
    except Exception:
        queries = [goal]
    queries = [*queries, f"{queries[0]} survey"]
    seen, found = set(), []
    for query in queries:
        try:
            results = scholar.search(query, limit=12)
        except Exception:
            continue
        for p in results:
            key = p["external_id"] or scholar.norm_title(p["title"])
            if p["title"] and key not in seen:
                seen.add(key)
                found.append(p)
    return found[:40]


def plan_with_ai(goal: str, found: list[dict]) -> Plan:
    listing = "\n\n".join(
        f"[{n}] {p['title']} ({p.get('year') or 'n.d.'}; {p.get('citations') or 'unknown'} citations;"
        f" {'full text available' if p.get('pdf_url') else 'no free PDF'})\n{(p.get('abstract') or '')[:500]}"
        for n, p in enumerate(found, 1))
    prompt = (
        "A researcher wants to reach this goal and needs a reading roadmap.\n\n"
        f"<goal>{goal}</goal>\n\n<candidates>\n{listing}\n</candidates>\n\n"
        "Pick the 5 to 10 candidates that best serve the goal and order them into 2 to 4 stages: the foundations a "
        "newcomer needs first (a survey or the classic paper that started it), then the core methods, then the newest "
        "or most advanced work. Prefer well-cited and recent papers, and ones with full text. Leave out papers that "
        "are off-topic or repeat another pick. For each pick give its number, one plain sentence on why to read it "
        "at that point (what it gives you), and about how many minutes a careful first read takes. Write a two-"
        "sentence intro describing the path. Use plain words."
    )
    return ai.parse(prompt, Plan, effort="medium")


def build(topic_id: int, goal: str) -> dict:
    found = candidates(goal)
    try:
        plan = plan_with_ai(goal, found) if found else Plan(intro="", stages=[])
        stages = []
        used = set()
        for st in plan.stages:
            items = []
            for pick in st.papers:
                if 1 <= pick.number <= len(found) and pick.number not in used:
                    used.add(pick.number)
                    items.append({**found[pick.number - 1], "reason": pick.reason, "minutes": max(5, pick.minutes)})
            if items:
                stages.append({"title": st.title, "why": st.why, "items": items})
        intro, by_ai = plan.intro, True
    except Exception:  # no AI (or it failed): the most cited results, as one stage
        ranked = sorted(found, key=lambda p: -(p.get("citations") or 0))[:8]
        used = {found.index(p) + 1 for p in ranked}
        stages = [{"title": "Most cited", "why": "Set up an AI model in Settings for a roadmap in reading order.",
                   "items": [{**p, "reason": "", "minutes": 0} for p in ranked]}] if ranked else []
        intro, by_ai = "", False
    others = [p for n, p in enumerate(found, 1) if n not in used]
    plan = {"goal": goal, "intro": intro, "by_ai": by_ai, "made_at": int(time.time()), "stages": stages,
            "others": others}
    for item in [i for s in stages for i in s["items"]] + others:
        item["paper_id"] = find_existing(item)
        item["in_library_before"] = bool(item["paper_id"])
    _save(topic_id, plan)
    return saved(topic_id)


def add(topic_id: int, external_ids: list[str]) -> tuple[dict, list[int]]:
    """Add the chosen papers to the goal. Returns the roadmap and the new papers whose PDFs are still to fetch."""
    plan = saved(topic_id)
    if not plan:
        raise ValueError("Make a roadmap first.")
    wanted = set(external_ids)
    to_fetch = []
    for item in [i for s in plan["stages"] for i in s["items"]] + plan["others"]:
        key = item["external_id"] or item["title"]
        if key not in wanted:
            continue
        if item.get("paper_id"):  # already in the library: into this goal if it has none yet
            if not get_paper(item["paper_id"]).get("topic_id"):
                update_paper(item["paper_id"], topic_id=topic_id)
            continue
        fields = {k: item.get(k) or "" for k in ("title", "authors", "abstract", "url", "pdf_url", "external_id")}
        item["paper_id"] = insert_paper({**fields, "year": item.get("year"), "topic_id": topic_id, "text": ""})
        to_fetch.append(item["paper_id"])
    _save(topic_id, plan)
    return saved(topic_id), to_fetch


def fetch_pdfs(paper_ids: list[int]) -> None:
    """In the background, one after the other: the PDF, its text, then the AI's preparation."""
    from papers.ingest import prepare_paper, read_pdf
    for paper_id in paper_ids:
        paper = get_paper(paper_id)
        if paper.get("pdf_url"):
            try:
                data = scholar.fetch_pdf(paper["pdf_url"])
                if pdf.is_pdf(data):
                    save_pdf(paper_id, data)
                    update_paper(paper_id, text=read_pdf(data))
            except Exception:
                pass  # the paper stays, with its abstract; a PDF can be uploaded later
        prepare_paper(paper_id)
