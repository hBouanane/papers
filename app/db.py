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
create table if not exists settings (key text primary key, value text);
create table if not exists explanations (
    id integer primary key,
    paper_id integer references papers(id),
    passage text not null,
    question text default '',
    answer text not null,
    created_at text default current_timestamp
);
create table if not exists notes (
    id integer primary key,
    paper_id integer references papers(id),
    kind text default 'note',
    body text default '',
    quote text default '',
    color text default 'yellow',
    page integer,
    position real default 0,
    anchor text,
    created_at text default current_timestamp,
    updated_at text default current_timestamp
);
"""



def connect() -> sqlite3.Connection:
    path = Path(os.environ.get("PAPERS_DB", "data/papers.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def pdf_path(paper_id: int) -> Path:
    return Path(os.environ.get("PAPERS_DB", "data/papers.db")).parent / "pdfs" / f"{paper_id}.pdf"


# Columns added after the first release; created on startup when missing.
NEW_COLUMNS = {"refs": "text", "read_slices": "text", "mirror_path": "text", "archived": "integer default 0",
               "review_step": "integer default 0", "review_due": "text",
               "notes": "text default ''", "notes_mirror": "text", "glossary": "text"}
JSON_FIELDS = ("skim", "quiz", "refs", "glossary")


EXPLANATION_COLUMNS = {"mode": "text default 'explain'"}


def init():
    with connect() as conn:
        conn.executescript(SCHEMA)
        for table, columns in (("papers", NEW_COLUMNS), ("explanations", EXPLANATION_COLUMNS)):
            have = {r["name"] for r in conn.execute(f"pragma table_info({table})")}
            for name, kind in columns.items():
                if name not in have:
                    conn.execute(f"alter table {table} add column {name} {kind}")
        # Notes used to be one free-text box per paper; that text becomes the paper's first note (once).
        if not conn.execute("select 1 from settings where key = 'notes_migrated'").fetchone():
            conn.execute("insert into notes (paper_id, body) select id, trim(notes) from papers p"
                         " where trim(coalesce(notes, '')) != '' and not exists (select 1 from notes n where n.paper_id = p.id)")
            conn.execute("insert into settings (key, value) values ('notes_migrated', '1')")


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for f in JSON_FIELDS:
        if d.get(f):
            d[f] = json.loads(d[f])
    return d
