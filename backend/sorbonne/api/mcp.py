"""The connector Claude talks to: MCP over Streamable HTTP, stateless, answering in JSON.

Two tools, and they are the application's own pages seen from the other side. One finds
what can be read — every GET the API offers, with what it is for — and the other reads
one, as the coordinator Claude is connected as. The read goes through the sign-in gate
like any other request, with the same key, so it can read exactly what that person can
and change nothing: the key is read-only, and the tool only ever asks for a GET.

That is deliberately the whole of it. A tool per page would have to be kept in step with
every page; these two follow the API as it grows.

Only what a tools-only server needs of the protocol is here: initialize, ping, the tool
list and tool calls. Notifications are acknowledged and otherwise ignored, and there is no
event stream to open, so GET answers 405 as the specification allows.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

router = APIRouter(include_in_schema=False)

#: Newest first; a client asking for one of these gets it, any other gets the first.
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
#: Claude takes about 150,000 characters of a tool's answer; leave room for the note.
MOST_RETURNED = 120_000
REFUSED = 400
#: Not for Claude: signing in, keys, and the developer's own copy of production.
UNREADABLE = ("/api/v1/auth", "/api/v1/dev")

INSTRUCTIONS = """\
SCEN Coordinator Tools is the planning application of the Department of Sciences and \
Engineering (SCEN) at Sorbonne University Abu Dhabi. It holds the department's semesters, \
cohorts (Foundation Year and Licence 1-3), group sets and groups, the courses and CRNs \
(sections) the registrar's portal publishes and their dated classes, teachers and their \
hours, rooms, class changes, and timesheets.

Use find_endpoints to see what can be read (search with a word or two: "cohort", "crn", \
"teacher hours", "room"), then read with the path and query it lists. Everything is \
read-only. Students appear by ID only: the server holds no student names or e-mails."""

TOOLS = [
    {
        "name": "find_endpoints",
        "title": "Find what can be read",
        "description": "List the parts of SCEN Coordinator Tools that can be read, each with its path, what it "
        "returns and the query parameters it takes. Search with a word or two; leave it empty for all of them.",
        "inputSchema": {
            "type": "object",
            "properties": {"search": {"type": "string", "description": "Words to look for, e.g. 'cohort groups'."}},
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "read",
        "title": "Read from Coordinator Tools",
        "description": "Read one path that find_endpoints lists, as the coordinator who connected Claude. Fill "
        "in the path's {placeholders}; give query parameters in `query`. Returns the JSON the application answers.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "A path from find_endpoints, e.g. /api/v1/rooms."},
                "query": {
                    "type": "object",
                    "description": "Query parameters, by name.",
                    "additionalProperties": {"type": ["string", "number", "boolean"]},
                },
            },
            "required": ["path"],
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
]


def _result(message_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "result": result}


def _error(message_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "error": {"code": code, "message": message}}


def _text(text: str, *, error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": error}


def _endpoints(request: Request, search: str) -> str:
    words = [word for word in search.casefold().split() if word]
    lines = []
    for path, operations in sorted(request.app.openapi().get("paths", {}).items()):
        get = operations.get("get")
        if get is None or not path.startswith("/api/v1/") or path.startswith(UNREADABLE):
            continue
        about = (get.get("description") or get.get("summary") or "").strip().split("\n")[0]
        params = [
            f"{param['name']}{'' if param.get('required') else '?'}"
            for param in get.get("parameters", [])
            if param.get("in") == "query"
        ]
        line = f"GET {path} — {about}" + (f" (query: {', '.join(params)})" if params else "")
        if all(word in line.casefold() for word in words):
            lines.append(line)
    if not lines:
        return "Nothing matches that. Try fewer or other words, or leave the search empty."
    return "\n".join(lines)


async def _read(request: Request, path: str, query: dict[str, Any]) -> dict[str, Any]:
    path = "/" + path.strip().lstrip("/")
    if not path.startswith("/api/v1/") or path.startswith(UNREADABLE) or "?" in path or ".." in path:
        return _text("Read a path that find_endpoints lists, with its query in `query`.", error=True)
    # The caller's own credentials, so the gate decides exactly as it would for them.
    headers = {name: request.headers[name] for name in ("authorization", "cookie") if name in request.headers}
    target = path + (f"?{urlencode({k: str(v) for k, v in query.items()})}" if query else "")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=request.app), base_url="http://internal") as client:
        answer = await client.get(target, headers=headers)
    if "json" not in answer.headers.get("content-type", ""):
        kind = answer.headers.get("content-type", "unknown").split(";")[0]
        return _text(f"{path} answers with a file ({kind}), which cannot be read here.", error=True)
    if answer.status_code >= REFUSED:
        try:
            detail = answer.json().get("detail", answer.text)
        except ValueError:
            detail = answer.text
        return _text(f"{answer.status_code}: {detail}", error=True)
    body = json.dumps(answer.json(), ensure_ascii=False, separators=(",", ":"))
    if len(body) > MOST_RETURNED:
        body = (
            body[:MOST_RETURNED]
            + f"\n\n[Cut off at {MOST_RETURNED:,} of {len(body):,} characters. Narrow it with query parameters.]"
        )
    return _text(body)


async def _answer(request: Request, message: Any) -> dict[str, Any] | None:  # noqa: PLR0911 - one per method
    """One JSON-RPC message in, its answer out — or None for a notification."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or "method" not in message:
        return _error(message.get("id") if isinstance(message, dict) else None, -32600, "Not a JSON-RPC request.")
    method, params, message_id = message["method"], message.get("params") or {}, message.get("id")
    if "id" not in message:
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        return _result(
            message_id,
            {
                "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "scen-coordinator-tools", "title": "SCEN Coordinator Tools", "version": "1"},
                "instructions": INSTRUCTIONS,
            },
        )
    if method == "ping":
        return _result(message_id, {})
    if method == "tools/list":
        return _result(message_id, {"tools": TOOLS})
    if method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments") or {}
        if name == "find_endpoints":
            return _result(message_id, _text(_endpoints(request, str(arguments.get("search") or ""))))
        if name == "read":
            query = arguments.get("query") if isinstance(arguments.get("query"), dict) else {}
            return _result(message_id, await _read(request, str(arguments.get("path") or ""), query))
        return _error(message_id, -32602, f"No tool called {name}.")
    return _error(message_id, -32601, f"{method} is not offered here.")


@router.post("/mcp")
async def mcp(request: Request) -> Response:
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse(_error(None, -32700, "That is not JSON."), status_code=400)
    if isinstance(body, list):
        answers = [answer for answer in [await _answer(request, message) for message in body] if answer]
        return JSONResponse(answers) if answers else Response(status_code=202)
    answer = await _answer(request, body)
    return JSONResponse(answer) if answer else Response(status_code=202)


@router.get("/mcp")
@router.delete("/mcp")
def no_stream() -> Response:
    """No event stream and no session to end: every answer comes back with its request."""
    return Response(status_code=405, headers={"Allow": "POST"})
