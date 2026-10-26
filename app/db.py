import json
import os
import sqlite3
from pathlib import Path

SCHEMA = """
create table if not exists topics (
    id integer primary key,
    goal text not null,
    created_at text default current_timestamp
);
create table if not exists papers (
    id integer primary key,
    topic_id integer references topics(id),
    title text not null,
    authors text default '',
    year integer,
    abstract text default '',
    url text default '',
    pdf_url text default '',
    external_id text default '',
    text text default '',
    skim text,
    status text default 'new',
    progress real default 0,
    position real default 0,
    understanding real,
    quiz text,
    source_paper_id integer references papers(id),
    updated_at text default current_timestamp
);
create virtual table if not exists papers_fts using fts5(title, abstract, text, summary);
"""

JSON_FIELDS = ("skim", "quiz")


def connect() -> sqlite3.Connection:
    path = Path(os.environ.get("PAPERS_DB", "data/papers.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def pdf_path(paper_id: int) -> Path:
    return Path(os.environ.get("PAPERS_DB", "data/papers.db")).parent / "pdfs" / f"{paper_id}.pdf"


def init():
    with connect() as conn:
        conn.executescript(SCHEMA)


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for f in JSON_FIELDS:
        if d.get(f):
            d[f] = json.loads(d[f])
    return d
