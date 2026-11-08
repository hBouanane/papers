from app import llm


def make(client):
    p = client.post("/api/papers", json={"title": "P"}).json()
    from app.main import update_paper
    update_paper(p["id"], text="Attention dispensing with recurrence.")
    return p


def test_simplify_and_translate_use_the_mode_and_language(client, monkeypatch):
    seen = []
    monkeypatch.setattr(llm, "explain", lambda paper, passage, question, mode="explain", language="": seen.append((mode, language)) or f"{mode}!")
    p = make(client)
    assert client.post(f"/api/papers/{p['id']}/explain", json={"passage": "x", "mode": "simplify"}).json() == {"explanation": "simplify!"}
    r = client.post(f"/api/papers/{p['id']}/explain", json={"passage": "x", "mode": "translate"})
    assert r.status_code == 400 and "language" in r.json()["detail"].lower()
    client.put("/api/settings", json={"language": "French"})
    assert client.post(f"/api/papers/{p['id']}/explain", json={"passage": "x", "mode": "translate"}).json() == {"explanation": "translate!"}
    assert seen == [("simplify", ""), ("translate", "French")]
    modes = [e["mode"] for e in client.get(f"/api/papers/{p['id']}/explanations").json()]
    assert modes == ["translate", "simplify"]


def test_language_setting_round_trips(client):
    assert client.get("/api/settings").json()["language"] == ""
    assert client.put("/api/settings", json={"language": "  Arabic "}).json()["language"] == "Arabic"


def test_save_a_word_from_the_text(client, monkeypatch):
    monkeypatch.setattr(llm, "define", lambda paper, term, context, language="": {
        "term": term, "kind": "english", "meaning": "Getting rid of.", "example": context, "translation": ""})
    p = make(client)
    words = client.post(f"/api/papers/{p['id']}/words", json={"term": "dispensing with", "context": "Attention dispensing with recurrence."}).json()
    assert [w["term"] for w in words] == ["dispensing with"]
    again = client.post(f"/api/papers/{p['id']}/words", json={"term": "Dispensing with", "context": "x"}).json()
    assert len(again) == 1  # already there
    assert client.get(f"/api/papers/{p['id']}").json()["glossary"][0]["meaning"] == "Getting rid of."


def test_glossary_asks_for_translations_when_a_language_is_set(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(llm, "glossary", lambda paper, language="": seen.setdefault("language", language) and [])
    p = make(client)
    client.put("/api/settings", json={"language": "French"})
    client.post(f"/api/papers/{p['id']}/glossary")
    assert seen["language"] == "French"
