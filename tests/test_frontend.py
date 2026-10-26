def test_serves_ui(client):
    r = client.get("/")
    assert r.status_code == 200 and "<title>Papers</title>" in r.text
    js = client.get("/js/main.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]


def test_paper_list_includes_external_id(client):
    client.post("/api/papers", json={"title": "P", "external_id": "x1"})
    assert client.get("/api/papers").json()[0]["external_id"] == "x1"
