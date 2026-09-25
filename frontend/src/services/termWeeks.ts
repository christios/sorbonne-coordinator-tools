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
