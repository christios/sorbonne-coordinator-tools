/**
 * Every call to our own API goes through here so the staff session cookie travels
 * with it. In production the app and the API share an origin and the cookie would
 * ride along anyway; in development they sit on different ports, where a plain
 * fetch would drop it and every request would come back as "sign in to continue".
 */
/**
 * Where the API is. In development it is a second server on another port, so a path on
 * its own would be asked of the Vite dev server, which answers 404 with an empty body —
 * an error about JSON rather than about the address. Every call needs this in front of it.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

/**
 * What a call says when the session behind it has ended, so the whole application can hear.
 *
 * A session does not only end by somebody pressing Sign out: it expires, it is ended in
 * another tab, and it stops being valid when the deployment restarts with a new secret.
 * In every one of those the page carried on showing the last session's figures — right
 * until somebody tried to save something — because nothing told the front door that the
 * lock had changed. An answer of "sign in to continue" is that telling.
 */
export const SIGNED_OUT = "sorbonne:signed-out";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: "include" });
  // 403 is a different thing — signed in, and not allowed this — and must not sign anybody
  // out. Only "we do not know who you are" ends a session.
  if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT));
  return response;
}
