import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.api import oidc
from app.config import Settings
from app.main import create_app
from app.models import Role

ISSUER = "https://idp.example.test/realms/soc"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
JWK = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key()))
JWK.update({"kid": "k1", "use": "sig", "alg": "RS256"})


class FakeIdp:
    def __init__(self):
        self.claims: dict = {}
        self.nonce = None
        self.token_requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/auth",
                    "token_endpoint": f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/certs",
                    "userinfo_endpoint": f"{ISSUER}/userinfo",
                    "id_token_signing_alg_values_supported": ["RS256"],
                    "token_endpoint_auth_methods_supported": ["client_secret_basic"],
                },
            )
        if path.endswith("/certs"):
            return httpx.Response(200, json={"keys": [JWK]})
        if path.endswith("/token"):
            form = parse_qs(request.content.decode())
            self.token_requests.append({"form": form, "auth": request.headers.get("authorization")})
            now = int(time.time())
            claims = {
                "iss": ISSUER,
                "aud": "magma",
                "iat": now,
                "exp": now + 300,
                "nonce": self.nonce,
                **self.claims,
            }
            token = jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})
            return httpx.Response(200, json={"id_token": token, "access_token": "at"})
        if path.endswith("/userinfo"):
            return httpx.Response(200, json={"groups": ["SOC-Analysts"]})
        return httpx.Response(404)


@pytest.fixture
def idp(monkeypatch):
    fake = FakeIdp()
    monkeypatch.setattr(
        oidc, "http_client", lambda: httpx.Client(transport=httpx.MockTransport(fake.handler))
    )
    oidc._discovery.clear()
    return fake


@pytest.fixture
def sso_client(tmp_path, idp):
    s = Settings(
        database_url=f"sqlite:///{tmp_path}/t.db",
        static_dir=tmp_path / "static",
        admin_password="admin-password-123",
        oidc_issuer=ISSUER,
        oidc_client_id="magma",
        oidc_client_secret="s3cret",
        oidc_role_map="SOC-Admins=admin, SOC-Analysts=analyst, Audit=auditor",
    )
    with TestClient(create_app(s), follow_redirects=False) as c:
        yield c


def sign_in(client, idp, claims, next_="/usecases"):
    r = client.get("/api/auth/oidc/login", params={"next": next_})
    assert r.status_code == 303
    loc = urlparse(r.headers["location"])
    q = parse_qs(loc.query)
    assert loc.path == "/realms/soc/auth" and q["code_challenge_method"] == ["S256"]
    idp.nonce = q["nonce"][0]
    idp.claims = claims
    return client.get("/api/auth/oidc/callback", params={"code": "c0de", "state": q["state"][0]})


def test_role_mapping():
    s = Settings(oidc_role_map="A=auditor,B=admin,C=analyst,D=bogus", oidc_role_claim="realm.roles")
    assert oidc.map_role({"realm": {"roles": ["A", "C"]}}, s) == Role.analyst
    assert oidc.map_role({"realm": {"roles": ["A", "B"]}}, s) == Role.admin
    assert oidc.map_role({"realm": {"roles": ["X"]}}, s) is None
    s.oidc_default_role = "auditor"
    assert oidc.map_role({}, s) == Role.auditor


def test_auth_config_shows_sso(sso_client):
    cfg = sso_client.get("/api/auth/config").json()
    assert cfg["sso_enabled"] and cfg["local_login_enabled"]


def test_sso_login_creates_user_and_session(sso_client, idp):
    r = sign_in(
        sso_client,
        idp,
        {
            "sub": "u-1",
            "preferred_username": "jana",
            "name": "Jana Analyst",
            "groups": ["SOC-Admins", "Audit"],
        },
    )
    assert r.status_code == 303 and r.headers["location"] == "/usecases"
    me = sso_client.get("/api/auth/me").json()
    assert me["username"] == "jana" and me["role"] == "admin" and me["auth_source"] == "sso"
    assert idp.token_requests[0]["auth"].startswith("Basic ")
    assert idp.token_requests[0]["form"]["code_verifier"]

    # role follows the IdP on the next login; no duplicate user
    sso_client.post("/api/auth/logout")
    sign_in(sso_client, idp, {"sub": "u-1", "preferred_username": "jana", "groups": ["Audit"]})
    assert sso_client.get("/api/auth/me").json()["role"] == "auditor"
    sso_client.post("/api/auth/logout")
    login = sso_client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin-password-123"}
    )
    users = sso_client.get("/api/users").json()
    assert login.status_code == 200 and sum(u["username"] == "jana" for u in users) == 1


def test_groups_from_userinfo(sso_client, idp):
    sign_in(sso_client, idp, {"sub": "u-2", "preferred_username": "tom"})
    assert sso_client.get("/api/auth/me").json()["role"] == "analyst"


def test_refused_logins(sso_client, idp):
    # a group that is not mapped and no default role -> no access
    r = sign_in(
        sso_client, idp, {"sub": "u-4", "preferred_username": "mallory", "groups": ["Other"]}
    )
    assert r.status_code == 303 and r.headers["location"].endswith("sso_error=no_access")
    assert sso_client.get("/api/auth/me").status_code == 401

    # a local account with the same name is not taken over
    r = sign_in(
        sso_client, idp, {"sub": "u-5", "preferred_username": "admin", "groups": ["SOC-Admins"]}
    )
    assert r.headers["location"].endswith("sso_error=local_account")
    assert sso_client.get("/api/auth/me").status_code == 401


def test_bad_state_and_bad_nonce(sso_client, idp):
    r = sso_client.get("/api/auth/oidc/callback", params={"code": "x", "state": "forged"})
    assert r.headers["location"].endswith("sso_error=expired")
    # the IdP's error text is not reflected onto the login page
    r = sso_client.get("/api/auth/oidc/callback", params={"error": "Call +1 555 now"})
    assert r.headers["location"] == "/login?sso_error=cancelled"

    r = sso_client.get("/api/auth/oidc/login")
    q = parse_qs(urlparse(r.headers["location"]).query)
    idp.nonce = "wrong"
    idp.claims = {"sub": "u-6", "groups": ["Audit"]}
    r = sso_client.get("/api/auth/oidc/callback", params={"code": "c", "state": q["state"][0]})
    assert r.headers["location"].endswith("sso_error=invalid_token")
    assert sso_client.get("/api/auth/me").status_code == 401


def test_sso_disabled_by_default(anon):
    assert anon.get("/api/auth/oidc/login", follow_redirects=False).status_code == 404
    assert not anon.get("/api/auth/config").json()["sso_enabled"]


def test_sso_username_is_normalised():
    from app.api.oidc import sso_username

    assert sso_username("Jane Doe <jane@x>") == "Jane_Doe_jane@x"
    assert sso_username("ok.name-1") == "ok.name-1"
    assert sso_username("??").startswith("sso_") and len(sso_username("x" * 200)) == 64
