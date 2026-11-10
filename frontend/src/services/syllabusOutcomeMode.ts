/**
 * Who writes the course learning outcomes, for the whole department (November 2026 review):
 * each course's teachers, in their syllabus, or the Head of Department, once per course in
 * the catalogue's curriculum mapping. Set by an administrator of the syllabus builder in
 * Settings → Department; read by every syllabus.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const MODE = `${API_BASE_URL}/api/v1/syllabus-outcome-mode`;

export type OutcomeMode = "teacher" | "hod";

export type OutcomeModeSetting = {
  mode: OutcomeMode;
  /** Blank while nobody has chosen. */
  updatedAt: string;
  updatedBy: string;
  updatedByName: string;
};

async function answer(response: Response): Promise<OutcomeModeSetting> {
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
  return (await response.json()) as OutcomeModeSetting;
}

export async function fetchOutcomeMode(): Promise<OutcomeModeSetting> {
  return answer(await apiFetch(MODE));
}

export async function setOutcomeMode(mode: OutcomeMode): Promise<OutcomeModeSetting> {
  return answer(
    await apiFetch(MODE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }),
  );
}

export const OUTCOME_MODE_KEY = ["syllabus-outcome-mode"] as const;

/** The mode every syllabus follows; "teacher" until it has been read. */
export function useOutcomeMode(): OutcomeMode {
  const setting = useQuery({ queryKey: OUTCOME_MODE_KEY, queryFn: fetchOutcomeMode, staleTime: 60_000 });
  return setting.data?.mode ?? "teacher";
}
