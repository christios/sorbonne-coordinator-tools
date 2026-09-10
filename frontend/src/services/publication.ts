/**
 * Publishing a semester's enrolments to the SCEN Student Hub.
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
  /** Groups that meet at the same hour. A warning, not a blocker: the timetable is what it is. */
  clashes: GroupClash[];
  isReady: boolean;
};

/** One hour of the week two CRNs both occupy, and how many dates it happens on. */
export type ClashWindow = { weekday: string; start: string; end: string; crns: string[]; dates: number };

/**
 * Two groups a student cannot sit in both of — or one group whose own CRNs meet at the
 * same hour. Read from the timetable, so it is what the Student Hub says, not a guess.
 */
export type GroupClash = {
  groups: { id: string; scopeId: string; scopeCode: string; label: string }[];
  windows: ClashWindow[];
  /** Who sits in both today. */
  students: string[];
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
  /**
   * How much of the semester the reading above could see.
   *
   * A clash count is a floor with its own error bar: it counts overlaps among the sections
   * somebody has times for, and says nothing about the rest. Without this beside it, "2
   * clashes" and "2 clashes out of 10 sections nobody has asked the registrar about" are
   * the same sentence.
   */
  coverage: TimetableCoverage;
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

export type TimetableCoverage = {
  /** False when no portal term is linked, so the registrar cannot be asked at all. */
  linked: boolean;
  portalTermCode: string;
  /** When the registrar's timetable was last swept, or "" if never. */
  pulledAt: string;
  /** Our live CRNs on this semester. */
  asked: number;
  /** How many of them anybody has hours for. */
  timetabled: number;
  /** The rest, by CRN: no clash can be found in a section nobody has times for. */
  blind: string[];
  /** Null when the Hub was not consulted; false when it was and would not answer. */
  hubReachable: boolean | null;
};

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
