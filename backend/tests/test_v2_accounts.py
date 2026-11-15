"""Account-scoped sync contract: these tests must pass before API wiring."""
import pytest

from jimbro.v2.accounts import Accounts, Conflict, InvalidCredentials, Unauthorized
from jimbro.v2.store import Store


@pytest.fixture
def accounts(tmp_path):
    return Accounts(Store(tmp_path / "sync.db"))


def test_registration_login_and_isolation(accounts):
    a = accounts.register("Alice@Example.com", "long-and-unique-password")
    b = accounts.register("bob@example.com", "different-unique-password")
    assert a["id"] != b["id"]
    with pytest.raises(InvalidCredentials):
        accounts.login("alice@example.com", "incorrect-password")
    token_a = accounts.login("alice@example.com", "long-and-unique-password")
    token_b = accounts.login("bob@example.com", "different-unique-password")
    assert accounts.who(token_a) == a["id"]
    assert accounts.who(token_b) == b["id"]
    assert accounts.get_snapshot(a["id"]) == {"revision": 0, "data": {}}
    accounts.save_snapshot(a["id"], {"history": [{"id": "a-workout"}]}, 0, "save-1")
    assert accounts.get_snapshot(a["id"])["revision"] == 1
    assert accounts.get_snapshot(b["id"]) == {"revision": 0, "data": {}}


def test_retry_is_idempotent_but_conflicting_payload_rejected(accounts):
    user = accounts.register("c@example.com", "really-long-password")["id"]
    payload = {"history": [{"id": "w1", "sets": [{"id": "s1"}]}], "plan": None}
    first = accounts.save_snapshot(user, payload, 0, "same-key")
    assert first["revision"] == 1
    assert accounts.save_snapshot(user, payload, 0, "same-key") == first
    assert accounts.get_snapshot(user)["data"] == payload
    with pytest.raises(Conflict):
        accounts.save_snapshot(user, {"history": []}, 0, "same-key")
    with pytest.raises(Conflict):
        accounts.save_snapshot(user, {"history": []}, 0, "new-key")
    assert accounts.get_snapshot(user)["revision"] == 1


def test_login_token_revoke_and_wrong_user(accounts):
    user = accounts.register("d@example.com", "strong-password-here")["id"]
    token = accounts.login("d@example.com", "strong-password-here")
    assert accounts.who(token) == user
    accounts.logout(token)
    with pytest.raises(Unauthorized):
        accounts.who(token)
    with pytest.raises(Unauthorized):
        accounts.who("not-a-token")


def test_reject_bad_accounts(accounts):
    with pytest.raises(ValueError):
        accounts.register("not-email", "strong-password-here")
    with pytest.raises(ValueError):
        accounts.register("a@example.com", "weak")
    accounts.register("a@example.com", "strong-password-here")
    with pytest.raises(Conflict):
        accounts.register("A@EXAMPLE.COM", "another-long-password")
