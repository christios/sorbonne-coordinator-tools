/**
 * Publishing a semester's enrolments to the SCEN Student Platform.
 *
 * Three calls, always in this order: ask what stands in the way, ask what would change, and
 * only then write. The middle one is not a formality — a publish replaces rather than
 * merges, so a cohort nobody filled arrives as students losing their timetable, and that has
 * to be visible before it happens.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/publication`;

/** What one cohort still needs before this semester can go out. */
export type CohortReadiness = {
  cohortId: string;
  cohort: string;
  students: number;
  studentsResolved: number;
  /** Scope code -> the students with no group for it. */
  unassigned: Record<string, string[]>;
  warnings: string[];
  isReady: boolean;
};

export type CrnVerdict = {
  status: "matched" | "unknown" | "mismatched" | "missing";
  detail: string;
  section?: { crn: string; code: string; kind: string; groupLabel: string };
};

export type Publication = {
  cohorts: CohortReadiness[];
  /** Keyed "groupId|courseCode", the same key the catalogue can look itself up by. */
  validation: Record<string, CrnVerdict>;
  unmatchedCrns: number;
  sections: number;
  resolved: { students: number; enrolments: number };
  isReady: boolean;
};

export type EnrolmentChange = {
  studentId: string;
  crns: string[];
  losesEverything?: boolean;
};

export type PublicationPreview = {
  term: { id: string; name: string; updatedAt: string };
  baseUpdatedAt: string;
  summary: {
    studentsBefore: number;
    studentsAfter: number;
    enrolmentsAdded: number;
    enrolmentsRemoved: number;
    enrolmentsUnchanged: number;
    studentsGaining: number;
    studentsLosing: number;
    studentsLosingEverything: number;
    unknownCrns: number;
  };
  gaining: EnrolmentChange[];
  losing: EnrolmentChange[];
  unknownCrns: string[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${BASE}${path}`, init);
  if (!response.ok) {
    let detail = "That could not be completed. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // keep the generic message
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function fetchPublication(termId: string): Promise<Publication> {
  return request<Publication>(`/terms/${termId}`);
}

export function previewPublication(termId: string): Promise<PublicationPreview> {
  return request<PublicationPreview>(`/terms/${termId}/preview`, { method: "POST" });
}

export function publishEnrolments(termId: string, baseUpdatedAt: string | null): Promise<{ studentCount: number }> {
  return request<{ studentCount: number }>(`/terms/${termId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_updated_at: baseUpdatedAt }),
  });
}
