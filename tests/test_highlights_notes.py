from app import db, library


def make(client, **kw):
    return client.post("/api/papers", json={"title": "P", **kw}).json()


def add(client, pid, **body):
    return client.post(f"/api/papers/{pid}/notes", json=body)


def items(client, pid):
    return client.get(f"/api/papers/{pid}/notes").json()


def test_add_several_notes_edit_and_delete_them(client):
    p = make(client)
    a = add(client, p["id"], body="  Compare with RNN baselines.  ", position=0.6).json()
    b = add(client, p["id"], body="Why 8 heads?", position=0.2).json()
    assert a["kind"] == "note" and a["body"] == "Compare with RNN baselines."
    assert [n["id"] for n in items(client, p["id"])] == [b["id"], a["id"]]  # in the paper's order
    r = client.patch(f"/api/notes/{b['id']}", json={"body": "Why 8 heads? See table 3."})
    assert r.json()["body"] == "Why 8 heads? See table 3." and r.json()["updated_at"]
    assert client.delete(f"/api/notes/{a['id']}").status_code == 204
    assert [n["id"] for n in items(client, p["id"])] == [b["id"]]
    assert client.patch(f"/api/notes/{a['id']}", json={"body": "x"}).status_code == 404


def test_highlight_keeps_quote_colour_and_place(client):
    p = make(client)
    anchor = {"page": 4, "rects": [[0.1, 0.2, 0.5, 0.02]]}
    h = add(client, p["id"], kind="highlight", quote="multi-head attention", color="green",
            page=4, position=0.31, anchor=anchor).json()
    assert (h["kind"], h["quote"], h["color"], h["page"], h["anchor"], h["body"]) == \
        ("highlight", "multi-head attention", "green", 4, anchor, "")
    # a note can be attached later, and the colour changed
    h = client.patch(f"/api/notes/{h['id']}", json={"body": "Key idea", "color": "pink"}).json()
    assert (h["body"], h["color"]) == ("Key idea", "pink")


def test_bad_notes_are_refused(client):
    p = make(client)
    assert add(client, p["id"], body="   ").status_code == 422  # a note needs text
    assert add(client, p["id"], kind="highlight", quote="").status_code == 422  # a highlight needs a quote
    assert add(client, p["id"], kind="highlight", quote="x", color="purple").status_code == 422
    assert add(client, 999, body="x").status_code == 404


def test_notes_and_highlights_are_searchable(client, monkeypatch):
    p = make(client, title="Noted One")
    add(client, p["id"], body="reminds me of momentum encoders")
    add(client, p["id"], kind="highlight", quote="label smoothing hurts perplexity")
    hits = lambda q: [r["paper"]["id"] for r in client.get("/api/search", params={"q": q}).json()]
    assert hits("momentum encoders") == [p["id"]] and hits("label smoothing") == [p["id"]]


def test_deleting_a_paper_deletes_its_notes(client):
    p = make(client)
    n = add(client, p["id"], body="x").json()
    client.delete(f"/api/papers/{p['id']}")
    assert client.delete(f"/api/notes/{n['id']}").status_code == 404


def test_old_free_text_notes_become_a_note(client):
    p = make(client)
    with db.connect() as conn:
        conn.execute("update papers set notes = 'old scratch notes' where id = ?", (p["id"],))
        conn.execute("delete from settings where key = 'notes_migrated'")
    db.init()
    assert [(n["kind"], n["body"]) for n in items(client, p["id"])] == [("note", "old scratch notes")]
    db.init()  # only once
    assert len(items(client, p["id"])) == 1


def test_notes_file_lists_highlights_and_notes(client, tmp_path):
    root = tmp_path / "Papers"
    client.put("/api/settings", json={"library_dir": str(root)})
    p = make(client, title="Noted")
    add(client, p["id"], kind="highlight", quote="we use label smoothing", page=8, position=0.8, body="Check effect")
    add(client, p["id"], body="Compare with Y.", position=0.1)
    md = (root / "Unsorted" / "Noted.md").read_text(encoding="utf-8")
    section = md.split("## My notes", 1)[1]
    assert section.index("Compare with Y.") < section.index("> we use label smoothing (p. 8)")
    assert "Check effect" in section and "## Add notes" in md


def test_notes_written_in_the_file_are_added(client, tmp_path):
    root = tmp_path / "Papers"
    client.put("/api/settings", json={"library_dir": str(root)})
    p = make(client, title="Noted")
    add(client, p["id"], body="from the app")
    md = root / "Unsorted" / "Noted.md"
    text = md.read_text(encoding="utf-8").replace("## Add notes\n", "## Add notes\n\nwritten in Obsidian\n- point\n", 1)
    md.write_text(text, encoding="utf-8")
    assert library.import_notes() == 1
    assert [n["body"] for n in items(client, p["id"])] == ["from the app", "written in Obsidian\n- point"]
    after = md.read_text(encoding="utf-8")
    assert "written in Obsidian" in after.split("## My notes", 1)[1].split("## Add notes")[0]  # now in the list
    assert library.import_notes() == 0  # the Add notes section was emptied
