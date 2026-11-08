from tests.test_papers import blank_pdf


def test_paper_list_says_which_papers_have_a_pdf_for_the_cover(client):
    with_pdf = client.post("/api/papers", json={"title": "Has a PDF"}).json()
    client.post(f"/api/papers/{with_pdf['id']}/pdf", files={"file": ("p.pdf", blank_pdf(), "application/pdf")})
    without = client.post("/api/papers", json={"title": "Only a title"}).json()
    papers = {p["id"]: p for p in client.get("/api/papers").json()}
    assert papers[with_pdf["id"]]["has_pdf"] is True
    assert papers[without["id"]]["has_pdf"] is False


def test_name_for_the_greeting_is_optional(client):
    assert client.get("/api/settings").json()["name"] == ""
    assert client.put("/api/settings", json={"name": "  Ada "}).json()["name"] == "Ada"
    # saving other settings leaves the name alone; an empty name clears it
    assert client.put("/api/settings", json={"language": "French"}).json()["name"] == "Ada"
    assert client.put("/api/settings", json={"name": ""}).json()["name"] == ""
