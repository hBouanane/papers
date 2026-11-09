"""Mirror of the library in a folder the user chose: one folder per goal, a PDF and a
Markdown notes file per paper, and an Inbox folder whose PDFs get imported.
The database stays the source of truth; the folder follows it."""
import re
import shutil
from pathlib import Path

from papers import db, index
from papers import notes as notes_db
from papers.chat import store as chat

INBOX = "Inbox"
UNSORTED = "Unsorted"


def root() -> Path | None:
    value = db.setting("library_dir")
    return Path(value) if value else None



def set_root(path: str) -> None:
    path = path.strip()
    if path and not Path(path).is_absolute():
        raise ValueError("Use a full folder path, like D:\\Papers or /Users/you/Papers.")
    with db.connect() as conn:
        conn.execute("insert or replace into settings (key, value) values ('library_dir', ?)", (path,))
    if path:
        for sub in (INBOX, UNSORTED):
            (Path(path) / sub).mkdir(parents=True, exist_ok=True)
        sync_all()


def safe_name(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    return re.sub(r"\s+", " ", name).strip(" .")[:120].strip(" .")


def paper_name(p: dict) -> str:
    """'Vaswani et al. 2017 - Attention Is All You Need'."""
    authors = p.get("authors") or ""
    names = [n.replace("et al.", "").strip() for n in authors.split(",") if n.strip()]
    surname = lambda n: n.split()[-1] if n else ""
    who = (f"{surname(names[0])} et al." if len(names) > 2 or "et al." in authors
           else " and ".join(surname(n) for n in names))
    cite = " ".join(x for x in (who, str(p["year"]) if p.get("year") else "") if x)
    return safe_name(" - ".join(x for x in (cite, p["title"]) if x)) or f"Paper {p['id']}"


def link_name(p: dict) -> str:
    return Path(p["mirror_path"]).name if p.get("mirror_path") else paper_name(p)


ADD_NOTES = "## Add notes"
ADD_HINT = "<!-- Anything you write here is added to the paper's notes in the app, then listed above. -->"


def notes(p: dict, goal: str | None, explanations: list[dict], parent: dict | None, children: list[dict],
          items: list[dict] = ()) -> str:
    status = {"new": "To read", "skimmed": "Skimmed", "reading": "Reading", "read": "Read"}[p["status"]]
    lines = [f"# {p['title']}", ""]
    if p.get("authors") or p.get("year"):
        year = f" ({p['year']})" if p.get("year") else ""
        lines.append(f"{p.get('authors') or ''}{year}".strip())
    lines.append(f"Status: {status}, {round((p['progress'] or 0) * 100)}% read"
                 + (f", understood {round(p['understanding'] * 100)}%" if p.get("understanding") is not None else ""))
    if goal:
        lines.append(f"Goal: {goal}")
    if p.get("url"):
        lines.append(f"Source: {p['url']}")
    lines += ["", "## My notes", "", notes_db.as_markdown(list(items)), "", ADD_NOTES, "", ADD_HINT]
    if s := p.get("skim"):  # older key points lack some fields
        lines += ["", "## Key points", "", s.get("tldr") or s["verdict"], ""]
        for heading, key in (("Problem", "problem"), ("Key idea", "key_idea"), ("Method", "method"),
                             ("Why it matters to me", "relevance"), ("Verdict", "verdict")):
            if s.get(key) and not (key == "verdict" and not s.get("tldr")):
                lines += [f"**{heading}.** {s[key]}", ""]
        for heading, key in (("Contributions", "contributions"), ("Results", "results"), ("Limitations", "limitations"),
                             ("Figures to look at", "figures"), ("Questions to keep in mind", "questions"),
                             ("Reading plan", "reading_plan"), ("Read closely", "read_closely")):
            if s.get(key):
                lines += [f"**{heading}**", *[f"- {x}" for x in s[key]], ""]
    if explanations:
        lines += ["", "## Explanations", ""]
        for e in explanations:
            if e["passage"]:
                lines += [*[f"> {line}" for line in e["passage"].splitlines()], ""]
            if e["question"]:
                lines += [f"*{e['question']}*", ""]
            lines += [e["answer"], ""]
    if p.get("glossary"):
        lines += ["", "## Vocabulary", ""]
        lines += [f"- **{w['term']}** ({'English' if w['kind'] == 'english' else 'technical'}): {w['meaning']}"
                  for w in p["glossary"]]
    if p.get("quiz"):
        lines += ["", "## Quiz", ""]
        for i, q in enumerate(p["quiz"], 1):
            lines += [f"{i}. {q['question']}", f"   - {q['answer']}"]
    if parent or children:
        lines += ["", "## Links", ""]
        if parent:
            lines.append(f"Found through [[{link_name(parent)}]]")
        lines += [f"Led to [[{link_name(c)}]]" for c in children]
    return "\n".join(lines).rstrip() + "\n"


def added_notes(md: str) -> str:
    """What was written under '## Add notes' in a notes file (comments left out)."""
    m = re.search(r"^## Add notes[ \t]*\n(.*?)(?=^## |\Z)", md, re.MULTILINE | re.DOTALL)
    return re.sub(r"<!--.*?-->", "", m[1], flags=re.DOTALL).strip() if m else ""


def refresh_notes_text(paper_id: int) -> None:
    """Keep the paper's plain-text notes (used by search and recall) in step with its list."""
    text = notes_db.as_text(notes_db.list_for(paper_id))
    with db.connect() as conn:
        conn.execute("update papers set notes = ? where id = ?", (text, paper_id))
        p = db.row_to_dict(conn.execute("select * from papers where id = ?", (paper_id,)).fetchone())
    if p:
        index.index_paper(p)


def pull_notes(base: Path, p: dict) -> bool:
    """Notes written under 'Add notes' in the file become a note in the app."""
    md = base / f"{p['mirror_path']}.md" if p.get("mirror_path") else None
    if not md or not md.exists():
        return False
    content = md.read_text(encoding="utf-8")
    text = added_notes(content)
    if not text:
        return False
    # Empty the section right away so the same text is never added twice.
    md.write_text(re.sub(r"(^## Add notes[ \t]*\n)(.*?)(?=^## |\Z)", lambda m: f"{m[1]}\n{ADD_HINT}\n",
                         content, count=1, flags=re.MULTILINE | re.DOTALL), encoding="utf-8")
    last = notes_db.list_for(p["id"])
    notes_db.add(p["id"], body=text, position=last[-1]["position"] if last else 0)
    refresh_notes_text(p["id"])
    return True


def import_notes() -> int:
    """Bring in notes edited in the folder (Obsidian, VS Code, ...); returns how many papers changed."""
    base = root()
    if not base:
        return 0
    with db.connect() as conn:
        papers = [db.row_to_dict(r) for r in conn.execute("select * from papers where mirror_path is not null")]
    changed = [p for p in papers if pull_notes(base, p)]
    for p in changed:
        sync_paper(p["id"], follow_parent=False)  # the new note moves from "Add notes" into the list
    return len(changed)


def sync_paper(paper_id: int, follow_parent: bool = True) -> None:
    base = root()
    if not base:
        return
    with db.connect() as conn:
        p = db.row_to_dict(conn.execute("select * from papers where id = ?", (paper_id,)).fetchone())
        if not p:
            return
        goal = conn.execute("select goal from topics where id = ?", (p["topic_id"],)).fetchone()
        explanations = chat.answers_for(paper_id)
        parent = db.row_to_dict(conn.execute("select * from papers where id = ?", (p["source_paper_id"],)).fetchone())
        children = [db.row_to_dict(r) for r in conn.execute("select * from papers where source_paper_id = ?", (paper_id,))]
        taken = {r["mirror_path"] for r in conn.execute(
            "select mirror_path from papers where id != ? and mirror_path is not null", (paper_id,))}

    rel = f"{safe_name(goal['goal']) if goal else UNSORTED}/{paper_name(p)}"
    if rel in taken:
        rel += f" ({paper_id})"
    old = p.get("mirror_path")
    if old and old != rel:
        for ext in (".pdf", ".md"):
            if (src := base / f"{old}{ext}").exists():
                (base / rel).parent.mkdir(parents=True, exist_ok=True)
                src.replace(base / f"{rel}{ext}")
    if pull_notes(base, {**p, "mirror_path": rel}):  # never lose notes written in the file
        with db.connect() as conn:
            p = db.row_to_dict(conn.execute("select * from papers where id = ?", (paper_id,)).fetchone())
    (base / rel).parent.mkdir(parents=True, exist_ok=True)
    stored = db.pdf_path(paper_id)
    target = base / f"{rel}.pdf"
    if stored.exists() and (not target.exists() or target.stat().st_size != stored.stat().st_size):
        shutil.copyfile(stored, target)
    text = notes(p, goal["goal"] if goal else None, explanations, parent, children, notes_db.list_for(paper_id))
    md = base / f"{rel}.md"
    if not md.exists() or md.read_text(encoding="utf-8") != text:
        md.write_text(text, encoding="utf-8")
    with db.connect() as conn:
        conn.execute("update papers set mirror_path = ? where id = ?", (rel, paper_id))
    if follow_parent and parent:
        sync_paper(parent["id"], follow_parent=False)  # its notes list this paper under "Led to"


def remove(paper: dict) -> None:
    """Delete a paper's files from the folder (the paper is being deleted)."""
    base = root()
    if base and paper.get("mirror_path"):
        for ext in (".pdf", ".md"):
            (base / f"{paper['mirror_path']}{ext}").unlink(missing_ok=True)


def sync_all() -> None:
    with db.connect() as conn:
        ids = [r["id"] for r in conn.execute("select id from papers order by id")]
    for paper_id in ids:
        sync_paper(paper_id, follow_parent=False)
