"""API keys: kept in the system keychain when there is one (faked here), else in the database; Settings only ever
sees whether one is saved and its last characters."""
import pytest

from papers import db, keys


class FakeKeychain:
    def __init__(self, refuse=False):
        self.store, self.refuse = {}, refuse

    def get_keyring(self):  # looks like the Windows Credential Manager backend
        return type("WinVaultKeyring", (), {"__module__": "keyring.backends.Windows"})()

    def set_password(self, service, name, value):
        if self.refuse:
            raise RuntimeError("locked")
        self.store[(service, name)] = value

    def get_password(self, service, name):
        return self.store.get((service, name))

    def delete_password(self, service, name):
        self.store.pop((service, name), None)


@pytest.fixture
def keychain(monkeypatch):
    fake = FakeKeychain()
    monkeypatch.setattr(keys, "_backend", fake)
    return fake


def test_keys_go_to_the_keychain_not_the_database(client, keychain):
    s = client.put("/api/settings", json={"ai_provider": "openrouter", "ai_api_key": "sk-or-1234567890abcd"}).json()
    assert keychain.store[("papers-app", "ai_key:openrouter")] == "sk-or-1234567890abcd"
    assert db.setting("ai_key:openrouter") == ""
    assert s["keys_saved"] == {"openrouter": "…abcd"} and s["keys_where"] == "Windows Credential Manager"
    assert "sk-or-1234567890abcd" not in str(s)  # the key itself never goes back to the page


def test_each_provider_keeps_its_own_key(client, keychain):
    client.put("/api/settings", json={"ai_provider": "openrouter", "ai_api_key": "sk-or-aaaaaaaa1111"})
    client.put("/api/settings", json={"ai_provider": "gemini", "ai_api_key": "gem-bbbbbbbb2222"})
    s = client.put("/api/settings", json={"ai_provider": "openrouter"}).json()
    assert s["keys_saved"] == {"openrouter": "…1111", "gemini": "…2222"}
    from papers.ai import providers
    assert providers.openai_config()["api_key"] == "sk-or-aaaaaaaa1111"


def test_forgetting_a_key(client, keychain):
    client.put("/api/settings", json={"ai_provider": "openrouter", "ai_api_key": "sk-or-1234567890abcd"})
    assert client.put("/api/settings", json={"ai_api_key": ""}).json()["keys_saved"] == {}
    assert keychain.store == {}


def test_keys_saved_in_the_database_move_to_the_keychain(client, keychain):
    db.set_setting("ai_key:openai", "sk-old-key-1234")
    assert keys.move_to_keychain() == 1
    assert db.setting("ai_key:openai") == "" and keys.get("ai_key:openai") == "sk-old-key-1234"


def test_without_a_keychain_keys_stay_in_the_database(client):
    s = client.put("/api/settings", json={"ai_provider": "openrouter", "ai_api_key": "sk-or-1234567890abcd"}).json()
    assert db.setting("ai_key:openrouter") == "sk-or-1234567890abcd"
    assert s["keys_where"] == "the app's database" and s["keys_saved"] == {"openrouter": "…abcd"}


def test_a_locked_keychain_falls_back_to_the_database(client, monkeypatch):
    monkeypatch.setattr(keys, "_backend", FakeKeychain(refuse=True))
    client.put("/api/settings", json={"ai_provider": "openrouter", "ai_api_key": "sk-or-1234567890abcd"})
    assert db.setting("ai_key:openrouter") == "sk-or-1234567890abcd"
