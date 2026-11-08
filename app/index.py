"""Full-text index of read papers (SQLite FTS5)."""
import json
import re

from app import db

STOPWORDS = {"the", "and", "for", "that", "this", "with", "from", "are", "was", "where", "did", "read", "idea"}


def fts_query(text: str) -> str:
    words = [w for w in re.findall(r"\w+", text.lower()) if len(w) > 2 and w not in STOPWORDS]
    return " OR ".join(f'"{w}"' for w in dict.fromkeys(words))


def index_paper(paper: dict):
    summary = json.dumps(paper["skim"]) if paper.get("skim") else ""
    with db.connect() as conn:
        conn.execute("delete from papers_fts where rowid = ?", (paper["id"],))
        conn.execute(
            "insert into papers_fts (rowid, title, abstract, text, summary) values (?, ?, ?, ?, ?)",
            (paper["id"], paper["title"], paper["abstract"], paper["text"], summary),
        )


def candidates(idea: str, limit: int = 10) -> list[dict]:
    """Papers matching the idea by keywords; falls back to recently read papers."""
    query = fts_query(idea)
    with db.connect() as conn:
        rows = []
        if query:
            rows = conn.execute(
                "select p.id, p.title, p.abstract, p.skim,"
                " snippet(papers_fts, 2, '', '', '…', 40) as snippet"
                " from papers_fts join papers p on p.id = papers_fts.rowid"
                " where papers_fts match ? order by rank limit ?",
                (query, limit),
            ).fetchall()
        if not rows:
            rows = conn.execute(
                "select id, title, abstract, skim, '' as snippet from papers"
                " where status = 'read' order by updated_at desc limit ?",
                (limit * 2,),
            ).fetchall()
    return [db.row_to_dict(r) for r in rows]
