def test_serves_ui(client):
    r = client.get("/")
    assert r.status_code == 200 and "<title>Papers</title>" in r.text
    assert client.get("/app.js").status_code == 200
