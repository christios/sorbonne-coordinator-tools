"""Signing in with a personal Microsoft account: the ID token checked here, with a key made for
the test standing in for Microsoft's, and the invited teacher's door taking it."""

from __future__ import annotations

import base64
import time
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import status
from fastapi.testclient import TestClient
from google.auth import crypt, jwt

from sorbonne.config import config
from sorbonne.services import microsoft_identity as microsoft
from sorbonne.services.staff_auth import SignInRejected

CLIENT = "11111111-2222-3333-4444-555555555555"
KID = "test-key"
WORK_DIRECTORY = "ef07ba01-f2c4-4eaa-99d4-57ab649ee4ff"


def _pem_of(private: rsa.RSAPrivateKey) -> str:
    plain = serialization.NoEncryption()
    return private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, plain).decode()


WORK = {"tid": WORK_DIRECTORY, "iss": f"https://login.microsoftonline.com/{WORK_DIRECTORY}/v2.0"}


@pytest.fixture(scope="module")
def key() -> tuple[str, str]:
    """A private key to sign with, and its certificate as Microsoft's key set carries it."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(private.public_key())
        .serial_number(1)
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(private, hashes.SHA256())
    )
    return _pem_of(private), base64.b64encode(certificate.public_bytes(serialization.Encoding.DER)).decode()


@pytest.fixture(autouse=True)
def microsoft_here(key: tuple[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "microsoft_client_id", CLIENT)
    monkeypatch.setattr(microsoft, "_fetch", lambda: {KID: microsoft._pem(key[1])})
    monkeypatch.setattr(microsoft, "_keys", {})


def token(key: tuple[str, str], **over: object) -> str:
    now = int(time.time())
    claims = {
        "iss": microsoft.ISSUER,
        "tid": microsoft.CONSUMERS,
        "aud": CLIENT,
        "iat": now,
        "exp": now + 3600,
        "email": "Prof.Someone@Outlook.com",
        "name": "Prof Someone",
        **over,
    }
    return jwt.encode(crypt.RSASigner.from_string(key[0], key_id=KID), claims).decode()


def test_a_personal_microsoft_account_signs_in_with_its_address(key: tuple[str, str]):
    assert microsoft.verify_microsoft_identity(token(key)) == ("prof.someone@outlook.com", "Prof Someone")
    # Without the email claim, the account's sign-in name is its address.
    no_email = token(key, email=None, preferred_username="someone@hotmail.com")
    assert microsoft.verify_microsoft_identity(no_email)[0] == "someone@hotmail.com"


@pytest.mark.parametrize(
    ("change", "words"),
    [
        (WORK, "not a work or school"),
        ({"aud": "another-application"}, "could not be verified"),
        ({"exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200}, "could not be verified"),
        ({"email": None, "preferred_username": "no address"}, "no e-mail address"),
    ],
)
def test_anything_else_is_refused_in_words(key: tuple[str, str], change: dict, words: str):
    with pytest.raises(SignInRejected, match=words):
        microsoft.verify_microsoft_identity(token(key, **change))


def test_a_token_signed_by_another_key_is_refused(key: tuple[str, str]):
    other = _pem_of(rsa.generate_private_key(public_exponent=65537, key_size=2048))
    claims = jwt.decode(token(key), verify=False)
    forged = jwt.encode(crypt.RSASigner.from_string(other, key_id=KID), claims).decode()
    with pytest.raises(SignInRejected, match="could not be verified"):
        microsoft.verify_microsoft_identity(forged)


def test_without_the_application_id_microsoft_is_not_offered(key: tuple[str, str], monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "microsoft_client_id", None)
    with pytest.raises(SignInRejected, match="not set up"):
        microsoft.verify_microsoft_identity(token(key))


def test_the_sign_in_config_names_the_microsoft_application(monkeypatch: pytest.MonkeyPatch):
    from sorbonne.main import app  # noqa: PLC0415

    answer = TestClient(app).get("/api/v1/auth/config")
    assert answer.status_code == 200
    assert answer.json()["microsoftClientId"] == CLIENT


# ---------------------------------------------------------------- the invited teacher's door

from tests import test_wish_invitations as invitations  # noqa: E402

# The invitations' own scratch database and client, as fixtures here too.
stores = invitations.stores
client = invitations.client
AT, DOOR, TERM = invitations.AT, invitations.DOOR, invitations.TERM


def test_an_invited_outlook_address_signs_in_with_microsoft_and_only_it(client: TestClient, key: tuple[str, str]):
    invitations.collecting(client)
    code = invitations.invited(client, "prof.someone@outlook.com")

    def sign_in(credential: str) -> object:
        return client.post(f"{DOOR}/{code}/session", json={"credential": credential, "provider": "microsoft"})

    assert sign_in(token(key, email="other@outlook.com")).status_code == status.HTTP_403_FORBIDDEN
    assert sign_in(token(key, **WORK)).status_code == status.HTTP_401_UNAUTHORIZED
    signed = sign_in(token(key))
    assert signed.status_code == 200, signed.text
    assert signed.json()["teacherName"] == "Joumana El Rifai"
    assert client.get(f"{DOOR}/{code}/form").status_code == 200


def test_an_outlook_address_on_the_list_signs_in_by_the_shared_link(client: TestClient, key: tuple[str, str]):
    invitations.collecting(client)
    invitations.invited(client, "prof.someone@outlook.com")
    code = client.post(f"{AT}/collection/{TERM}/share-link").json()["shareCode"]

    def sign_in(credential: str) -> object:
        return client.post(f"{DOOR}/{code}/session", json={"credential": credential, "provider": "microsoft"})

    assert sign_in(token(key, email="other@outlook.com")).status_code == status.HTTP_403_FORBIDDEN
    signed = sign_in(token(key))
    assert signed.status_code == 200, signed.text
    assert signed.json()["teacherName"] == "Joumana El Rifai"
