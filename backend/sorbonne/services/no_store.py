"""Every answer from the API says it must not be kept.

Nothing here ever said otherwise, and a browser still kept one: a coordinator's Chrome went
on answering the student lists from a copy it had stored that morning, through a sync and a
hard reload, while the server held the afternoon's — the request never left the browser.
An answer with no instruction leaves the browser to decide; this takes the decision away.

It is also the right rule for what these answers are. They are signed-in data about
students and staff, and a shared computer's cache is not a place for them.

A plain ASGI wrapper rather than BaseHTTPMiddleware, so a streamed download passes through
untouched, and outside the sign-in gate, so a "sign in to continue" is not kept either.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

API_PREFIX = "/api/"


class NoStore:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(API_PREFIX):
            await self.app(scope, receive, send)
            return

        async def marked(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                # An endpoint that has said how it may be kept knows better than this does.
                if not any(name.lower() == b"cache-control" for name, _ in headers):
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, marked)
