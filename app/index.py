"""Full-text index of every paper (SQLite FTS5); recall only looks at finished ones."""
import json
import re

from app import db

STOPWORDS = {"the", "and", "for", "that", "this", "with", "from", "are", "was", "where", "did", "read", "idea"}


def fts_query(text: str) -> str:
    words = [w for w in re.findall(r"\w+", text.lower()) if len(w) > 2 and w not in STOPWORDS]
    return " OR ".join(f'"{w}"' for w in dict.fromkeys(words))


def index_paper(paper: dict):
    """Index the paper with its key points, your notes and the explanations you asked for."""
    skim = paper.get("skim")
    parts = [(skim if isinstance(skim, str) else json.dumps(skim)) if skim else "", paper.get("notes") or ""]
    with db.connect() as conn:
        parts += [" ".join(r) for r in conn.execute(
            "select passage, question, answer from explanations where paper_id = ?", (paper["id"],))]
    summary = "\n".join(p for p in parts if p)
    with db.connect() as conn:
        conn.execute("delete from papers_fts where rowid = ?", (paper["id"],))
        conn.execute(
            "insert into papers_fts (rowid, title, abstract, text, summary) values (?, ?, ?, ?, ?)",
            (paper["id"], paper["title"], paper["abstract"], paper["text"], summary),
        )


def candidates(idea: str, limit: int = 10) -> list[dict]:
    """Papers matching the idea by keywords (finished ones first); falls back to recently read
    papers. Matches can come from the text, key points, your notes or your explanations."""
    query = fts_query(idea)
    with db.connect() as conn:
        rows = []
        if query:
            rows = conn.execute(
                "select p.id, p.title, p.abstract, p.skim,"
                " snippet(papers_fts, -1, '', '', '…', 30) as snippet"
                " from papers_fts join papers p on p.id = papers_fts.rowid"
                " where papers_fts match ? and coalesce(p.archived, 0) = 0"
                " order by p.status = 'read' desc, rank limit ?",
                (query, limit),
            ).fetchall()
        if not rows:
            rows = conn.execute(
                "select id, title, abstract, skim, '' as snippet from papers"
                " where status = 'read' order by updated_at desc limit ?",
                (limit * 2,),
            ).fetchall()
    return [db.row_to_dict(r) for r in rows]


def remove(paper_id: int):
    with db.connect() as conn:
        conn.execute("delete from papers_fts where rowid = ?", (paper_id,))


def backfill():
    """Index papers added before every paper was indexed."""
    with db.connect() as conn:
        rows = conn.execute(
            "select * from papers where id not in (select rowid from papers_fts)").fetchall()
    for row in rows:
        index_paper(dict(row))


LIST_COLUMNS = ("p.id, p.topic_id, p.title, p.authors, p.year, p.external_id, p.status, p.progress,"
                " p.position, p.understanding, p.source_paper_id, p.read_slices, p.archived, p.updated_at")


def search(q: str, limit: int = 30) -> list[dict]:
    """Library search: every word must appear (prefixes count) in title, authors or text."""
    words = list(dict.fromkeys(re.findall(r"\w+", q.lower())))
    if not words:
        return []
    with db.connect() as conn:
        by_name = conn.execute(
            f"select {LIST_COLUMNS}, '' as snippet from papers p where "
            + " and ".join("lower(p.title || ' ' || p.authors) like ?" for _ in words)
            + " order by p.updated_at desc limit ?",
            (*[f"%{w}%" for w in words], limit),
        ).fetchall()
        by_text = conn.execute(
            f"select {LIST_COLUMNS}, snippet(papers_fts, -1, '[', ']', '…', 24) as snippet"
            " from papers_fts join papers p on p.id = papers_fts.rowid"
            " where papers_fts match ? order by rank limit ?",
            (" AND ".join(f'"{w}"*' for w in words), limit),
        ).fetchall()
    seen, results = set(), []
    for row in [*by_name, *by_text]:
        if row["id"] not in seen:
            seen.add(row["id"])
            paper = dict(row)
            results.append({"snippet": paper.pop("snippet"), "paper": paper})
    return results[:limit]
