from app import db


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_db_creates_tables(client):
    with db.connect() as conn:
        names = {r[0] for r in conn.execute("select name from sqlite_master")}
    assert {"topics", "papers", "papers_fts"} <= names
