/**
 * Where each semester's Week 1 is — set by an administrator in Settings → Semesters.
 *
 * `semester id -> any day of its first teaching week`; the week that day falls in is Week 1.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/term-weeks`;

async function answer(response: Response): Promise<Record<string, string>> {
  if (!response.ok) {
    let detail = "That could not be saved. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the default sentence stands
    }
    throw new Error(detail);
  }
  return ((await response.json()) as { weeks: Record<string, string> }).weeks;
}

export async function fetchTermWeeks(): Promise<Record<string, string>> {
  return answer(await apiFetch(BASE));
}

/** A blank day takes the semester's Week 1 away. */
export async function setWeekOne(termId: string, weekOne: string): Promise<Record<string, string>> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(termId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekOne }),
    }),
  );
}

/**
 * The Week 1 for a portal term: from whichever semester linked to it says where Week 1 is.
 *
 * More than one semester can be linked to the same portal term — a test copy, a semester
 * made twice — and only one of them may have its Week 1 set. Taking the first link found
 * gave no week number at all when that one happened to be the other.
 */
export function weekOneOf(termCode: string, links: Record<string, string>, weeks: Record<string, string>): string | undefined {
  if (!termCode) return undefined;
  return Object.entries(links)
    .filter(([, code]) => code === termCode)
    .map(([termId]) => weeks[termId])
    .find(Boolean);
}

/** The semester linked to a portal term, preferring one that says where its Week 1 is. */
export function semesterOf(termCode: string, links: Record<string, string>, weeks: Record<string, string>): string {
  const linked = Object.entries(links).filter(([, code]) => code === termCode).map(([termId]) => termId);
  return linked.find((termId) => weeks[termId]) ?? linked[0] ?? "";
}
