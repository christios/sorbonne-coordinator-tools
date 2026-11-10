"""The way Claude signs in: OAuth 2.1 for a custom connector.

Claude finds all of this on its own from the address a coordinator pastes into it, the
connector at `/mcp`:

1. `/mcp` answers 401 with a pointer to `/.well-known/oauth-protected-resource`, which
   names this application as the server that signs Claude in;
2. `/.well-known/oauth-authorization-server` says where to register, allow and exchange;
3. Claude registers itself at `/oauth/register`;
4. the coordinator is sent to `/oauth/authorize`, signs in with Google if this browser is
   not signed in already, and allows Claude to read as them — or does not;
5. Claude trades the code for a key at `/oauth/token`, and renews it there.

None of these are behind the sign-in gate: Claude's servers call them before anybody is
signed in, and the page in step 4 signs the coordinator in itself.
"""

from __future__ import annotations

import hmac
from hashlib import sha256
from html import escape
from typing import Any
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from sorbonne.config import config
from sorbonne.services.connector_auth import (
    MCP_PATH,
    SCOPE,
    ConnectorStore,
    GrantRejected,
    RegistrationRejected,
    callback_matches,
    public_base,
)
from sorbonne.services.staff_auth import SESSION_COOKIE, StaffUser, read_session

router = APIRouter(include_in_schema=False)


def get_connectors() -> ConnectorStore:
    return ConnectorStore(config.database_url)


def signed_in_user(request: Request) -> StaffUser | None:
    """Who this browser is signed in as. A seam, so a test can be somebody."""
    return read_session(request.cookies.get(SESSION_COOKIE))


# ------------------------------------------------------------- discovery


@router.get("/.well-known/oauth-protected-resource")
@router.get(f"/.well-known/oauth-protected-resource{MCP_PATH}")
def protected_resource(request: Request) -> dict[str, Any]:
    """RFC 9728: what the connector is, and who signs callers in to it."""
    base = public_base(request)
    return {
        "resource": f"{base}{MCP_PATH}",
        "authorization_servers": [base],
        "scopes_supported": [SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": "SCEN Coordinator Tools",
    }


@router.get("/.well-known/oauth-authorization-server")
def authorization_server(request: Request) -> dict[str, Any]:
    """RFC 8414. Registration is dynamic; there is no client metadata document to fetch."""
    base = public_base(request)
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [SCOPE, "offline_access"],
    }


# ------------------------------------------------------------- registering


def _oauth_error(error: str, description: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": error, "error_description": description})


@router.post("/oauth/register")
async def register(request: Request, connectors: ConnectorStore = Depends(get_connectors)) -> Response:
    """RFC 7591, for a public client: no secret, PKCE instead."""
    try:
        body = await request.json()
    except ValueError:
        return _oauth_error("invalid_client_metadata", "The registration must be JSON.")
    if not isinstance(body, dict):
        return _oauth_error("invalid_client_metadata", "The registration must be a JSON object.")
    if body.get("token_endpoint_auth_method", "none") != "none":
        return _oauth_error("invalid_client_metadata", "Only public clients are registered here: use none.")
    uris = body.get("redirect_uris")
    try:
        client = connectors.register(
            name=str(body.get("client_name") or ""), redirect_uris=uris if isinstance(uris, list) else []
        )
    except RegistrationRejected as exc:
        return _oauth_error("invalid_redirect_uri", str(exc))
    return JSONResponse(
        status_code=201,
        content={
            "client_id": client["id"],
            "client_name": client["name"],
            "redirect_uris": client["redirectUris"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
    )


# ------------------------------------------------------------- allowing


#: What the page carries from Claude's request to the coordinator's answer.
CARRIED = ("client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource")


def _proof(user: StaffUser, fields: dict[str, str]) -> str:
    """Ties an answer to the person and the request it was asked about, so another page
    cannot post one on their behalf."""
    message = "|".join([user.email, *(fields.get(name, "") for name in CARRIED)])
    return hmac.new((config.session_secret or "").encode(), message.encode(), sha256).hexdigest()


def _page(title: str, body: str, status_code: int = 200) -> HTMLResponse:
    """A plain page in the application's colours. Nothing may frame it: a framed Allow is a
    button somebody else's page can trick a coordinator into pressing."""
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} · SCEN Coordinator Tools</title>
<style>
  body {{ margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #171717;
         background: #f5f7fa; }}
  main {{ max-width: 30rem; margin: 10vh auto; padding: 0 1rem; }}
  .card {{ background: #fff; border: 1px solid #d9dee7; border-radius: 12px; padding: 1.75rem; }}
  .kicker {{ font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #667085;
            margin: 0; }}
  h1 {{ font-size: 1.35rem; margin: .25rem 0 1rem; }}
  p, li {{ color: #344054; }}
  ul {{ padding-left: 1.2rem; }}
  .who {{ font-weight: 600; color: #171717; }}
  .actions {{ display: flex; gap: .6rem; margin-top: 1.5rem; }}
  button {{ font: inherit; font-weight: 600; border-radius: 8px; padding: .55rem 1.1rem; cursor: pointer; }}
  .allow {{ background: #1f4e79; color: #fff; border: 1px solid #1f4e79; }}
  .deny {{ background: #fff; color: #344054; border: 1px solid #b7bec8; }}
  .error {{ color: #a6292f; }}
  .small {{ font-size: 13px; color: #667085; }}
</style></head>
<body><main><div class="card"><p class="kicker">SCEN Coordinator Tools</p>{body}</div></main></body></html>"""
    return HTMLResponse(
        html,
        status_code=status_code,
        headers={"X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'"},
    )


def _refused(message: str) -> HTMLResponse:
    # Shown here rather than sent back: an address that is not the client's own is exactly
    # the one a code must never be sent to.
    return _page(
        "Claude cannot connect",
        f"<h1>Claude cannot connect</h1><p class='error'>{escape(message)}</p>"
        "<p>Remove the connector in Claude and add it again.</p>",
        status_code=400,
    )


def _checked(fields: dict[str, str], connectors: ConnectorStore) -> tuple[dict[str, Any] | None, str]:
    """The client, or why this request cannot be answered at all."""
    client = connectors.client(fields.get("client_id", ""))
    if client is None:
        return None, "This connection was not registered here."
    if not callback_matches(client["redirectUris"], fields.get("redirect_uri", "")):
        return None, "This connection asked to be sent somewhere it did not register."
    if fields.get("code_challenge_method") != "S256" or not fields.get("code_challenge"):
        return None, "This connection did not protect its code (PKCE with S256 is required)."
    return client, ""


def _back(redirect_uri: str, **params: str) -> RedirectResponse:
    joiner = "&" if "?" in redirect_uri else "?"
    query = urlencode({name: value for name, value in params.items() if value})
    return RedirectResponse(f"{redirect_uri}{joiner}{query}", status_code=302)


@router.get("/oauth/authorize")
def authorize(request: Request, connectors: ConnectorStore = Depends(get_connectors)) -> Response:
    """Ask the coordinator — signing them in first, if this browser has not."""
    fields = {name: request.query_params.get(name, "") for name in CARRIED}
    client, problem = _checked(fields, connectors)
    if client is None:
        return _refused(problem)
    if request.query_params.get("response_type") != "code":
        return _back(fields["redirect_uri"], error="unsupported_response_type", state=fields["state"])

    user = signed_in_user(request)
    if user is None:
        # Google's own button, on this page, then the same page again — now signed in.
        client_id = escape(config.google_auth_client_id or "")
        return _page(
            "Sign in",
            f"""<h1>Sign in to connect Claude</h1>
<p>Claude is asking to read SCEN Coordinator Tools as you. Sign in with the Google account you use here.</p>
<div id="g_id_onload" data-client_id="{client_id}" data-callback="signedIn" data-auto_prompt="false"></div>
<div class="g_id_signin" data-type="standard" data-size="large" data-text="signin_with"></div>
<p id="error" class="error"></p>
<script src="https://accounts.google.com/gsi/client" async></script>
<script>
  function signedIn(answer) {{
    fetch("/api/v1/auth/session", {{
      method: "POST", credentials: "same-origin",
      headers: {{ "Content-Type": "application/json" }},
      body: JSON.stringify({{ credential: answer.credential }}),
    }}).then(function (response) {{
      if (response.ok) {{ window.location.reload(); return; }}
      response.json().then(function (body) {{
        document.getElementById("error").textContent = body.detail || "That sign-in did not work.";
      }});
    }});
  }}
</script>""",
        )

    hidden = "".join(
        f'<input type="hidden" name="{name}" value="{escape(fields[name])}">' for name in CARRIED
    )
    # The host, which is what the specification asks a consent page to show plainly.
    destination = escape(urlsplit(fields["redirect_uri"]).netloc or fields["redirect_uri"])
    return _page(
        "Allow Claude",
        f"""<h1>Allow {escape(client["name"])} to read Coordinator Tools?</h1>
<p>Signed in as <span class="who">{escape(user.email)}</span>.</p>
<ul>
  <li>It can read what you can read here: timetables, CRNs, groups, teachers, rooms and hours.</li>
  <li>It cannot change anything.</li>
  <li>It never sees student names or e-mails — this application does not hold them.</li>
  <li>It stops the moment you disconnect it in Settings, or your access here ends.</li>
</ul>
<p class="small">You will be sent back to {destination}.</p>
<form method="post" action="/oauth/authorize">{hidden}
  <input type="hidden" name="proof" value="{_proof(user, fields)}">
  <div class="actions">
    <button class="allow" type="submit" name="decision" value="allow">Allow</button>
    <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
  </div>
</form>""",
    )


@router.post("/oauth/authorize")
async def decide(request: Request, connectors: ConnectorStore = Depends(get_connectors)) -> Response:
    form = await request.form()
    fields = {name: str(form.get(name, "")) for name in CARRIED}
    client, problem = _checked(fields, connectors)
    if client is None:
        return _refused(problem)
    user = signed_in_user(request)
    if user is None or not hmac.compare_digest(str(form.get("proof", "")), _proof(user, fields)):
        return _refused("This answer could not be matched to your sign-in. Start again from Claude.")
    if form.get("decision") != "allow":
        return _back(fields["redirect_uri"], error="access_denied", state=fields["state"])
    code = connectors.issue_code(
        client_id=client["id"],
        email=user.email,
        redirect_uri=fields["redirect_uri"],
        code_challenge=fields["code_challenge"],
    )
    return _back(fields["redirect_uri"], code=code, state=fields["state"])


# ------------------------------------------------------------- the key


@router.post("/oauth/token")
async def token(request: Request, connectors: ConnectorStore = Depends(get_connectors)) -> Response:
    """RFC 6749 §4.1.3 and §6, form-encoded as Claude sends them."""
    form = await request.form()
    grant_type = str(form.get("grant_type", ""))
    client_id = str(form.get("client_id", ""))
    try:
        if grant_type == "authorization_code":
            keys = connectors.redeem(
                client_id=client_id,
                code=str(form.get("code", "")),
                redirect_uri=str(form.get("redirect_uri", "")),
                verifier=str(form.get("code_verifier", "")),
            )
        elif grant_type == "refresh_token":
            keys = connectors.refresh(client_id=client_id, refresh_token=str(form.get("refresh_token", "")))
        else:
            return _oauth_error("unsupported_grant_type", "Only authorization_code and refresh_token are offered.")
    except GrantRejected as exc:
        return _oauth_error("invalid_grant", str(exc))
    return JSONResponse(keys.as_response(), headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
