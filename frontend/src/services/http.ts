/**
 * Every call to our own API goes through here so the staff session cookie travels
 * with it. In production the app and the API share an origin and the cookie would
 * ride along anyway; in development they sit on different ports, where a plain
 * fetch would drop it and every request would come back as "sign in to continue".
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}
