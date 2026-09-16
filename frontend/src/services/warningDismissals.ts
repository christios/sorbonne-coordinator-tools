/**
 * Warnings the department has decided to live with.
 *
 * "Yes, I know, they are staying in the group anyway." A dismissal points at a warning's
 * key, which changes on its own when the underlying fact changes — so a dismissed warning
 * comes back when the record changes again, with nothing having to expire it.
 *
 * On the server, and so the same for everybody. It was kept in whichever browser it was
 * made in, which meant the next coordinator to open the page met the warning again with
 * nothing to say it had already been weighed, and either weighed it again or acted on it.
 *
 * Signed and dated, because a shared dismissal hides something from somebody who never saw
 * it: the page shows who decided and when, in place of the warning, and anybody can bring
 * it back.
 *
 * Nothing prunes the list. The browser store this replaces was pruned to stay small, and
 * that pruning was its one dangerous act — each browser judged "this warning is gone" from
 * its own evidence, so pruning a shared list would let one browser throw away decisions
 * made against warnings only another browser can see.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = "/api/v1/student-database";

export type Dismissal = {
  /** The warning's own key. */
  key: string;
  byEmail: string;
  byName: string;
  /** ISO, as the server wrote it. */
  at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    let detail = "";
    try {
      detail = String(((await response.json()) as { detail?: unknown }).detail ?? "");
    } catch {
      // No body worth reading; the status says enough.
    }
    throw new Error(detail || "That could not be saved. Try again in a moment.");
  }
  return (await response.json()) as T;
}

export async function fetchDismissals(): Promise<Dismissal[]> {
  return (await request<{ dismissals: Dismissal[] }>(`${BASE}/warning-dismissals`)).dismissals;
}

/**
 * Dismiss a warning for everybody, or bring it back for everybody.
 *
 * The key goes in the body rather than the path: a warning's key is student ids, portal
 * codes and CRNs joined by whatever punctuation reads best, and some of it comes from the
 * portal, so it is not something to put through a URL and hope.
 */
export async function setDismissal(key: string, dismissed: boolean): Promise<Dismissal | null> {
  const answer = await request<{ dismissal: Dismissal | null }>(`${BASE}/warning-dismissals`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, dismissed }),
  });
  return answer.dismissal;
}

/** Who dismissed what, by key — the shape the page asks its questions in. */
export function dismissalsByKey(dismissals: Dismissal[]): Map<string, Dismissal> {
  return new Map(dismissals.map((dismissal) => [dismissal.key, dismissal]));
}
