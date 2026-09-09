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

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}
