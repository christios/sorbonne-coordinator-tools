# API tokens

Confirmed intent, 5 September 2026.

- **Outcome:** a coordinator can act on this application from a script or a terminal,
  without a browser. Christian asked for "the necessary credentials to start calling the
  API from here"; there were none to be had, because everything is authorised from the
  Google sign-in cookie, which is HttpOnly and cannot be read or reused outside the
  browser, and the only other way in is a Google ID token that needs a sign-in flow.
- **Shape:** Settings gains an API tokens page. A coordinator names a token, chooses how
  long it lasts, and is shown it once. Programs send it as `Authorization: Bearer <token>`.
- **Identity:** a token carries the identity of whoever made it, and nothing more. Whether
  that person is still admitted, and whether they administer the application, is read from
  the staff list on every request — exactly the question the cookie is asked — so removing
  somebody in Settings disarms their tokens in the same breath.
- **Storage:** only a SHA-256 hash is kept, with the first twelve characters so two tokens
  can be told apart in the list. The token itself exists once, in the answer that made it.
- **Limits:** a token cannot make or revoke tokens — that is done from a signed-in browser,
  so one leaked string cannot become a permanent way in. Tokens expire (7, 30, 90 days or a
  year) and can be revoked; a revoked one stays in the list, marked, rather than vanishing.
- **Out of scope:** tokens scoped to fewer powers than their owner has; machine accounts
  with no person behind them; rotating a token in place.
