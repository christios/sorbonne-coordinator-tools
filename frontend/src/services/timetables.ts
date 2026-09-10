import type { Operation, TimetablePreview } from "@/services/timetableDiff";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type TimetableTerm = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  isPublished: boolean;
  courseCount: number;
  sessionCount: number;
  studentCount: number;
  timetableFilename: string;
  enrolmentFilename: string;
  updatedAt: string;
  unknownCrns?: string[];
  studentLists?: StudentListReport[];
};

export type TimetableIntegrationStatus = {
  configured: boolean;
  host: string | null;
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // fall through to the generic message
  }
  return "The upload could not be completed. Try again in a moment.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Always send the staff session cookie: in development this app and the API sit on
  // different ports, where a plain fetch drops it and every call comes back as 401.
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "include" });
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchTimetableStatus(): Promise<TimetableIntegrationStatus> {
  return request<TimetableIntegrationStatus>("/api/v1/timetables/status");
}

export async function fetchTimetableTerms(): Promise<TimetableTerm[]> {
  const payload = await request<{ terms: TimetableTerm[] }>("/api/v1/timetables/terms");
  return payload.terms;
}

export type StudentListReport = {
  filename: string;
  style: "groups" | "crns";
  sheets: string[];
  students: number;
  unknownGroups: string[];
};

/**
 * Create a semester from the registrar's export alone.
 *
 * No student lists: who is in which group is this application's own knowledge now, and it
 * reaches the platform through the publish step. A semester therefore arrives with nobody
 * on it, which is the normal state of one that has not been published to yet.
 */
export function importTimetableTerm(input: { name: string; timetable: File }): Promise<TimetableTerm> {
  const body = new FormData();
  body.set("name", input.name);
  body.set("timezone", "Asia/Dubai");
  body.set("timetable", input.timetable);
  return request<TimetableTerm>("/api/v1/timetables/terms", { method: "POST", body });
}

export function previewTimetableUpdate(termId: string, timetable: File): Promise<TimetablePreview> {
  const body = new FormData();
  body.set("timetable", timetable);
  return request<TimetablePreview>(`/api/v1/timetables/terms/${termId}/timetable/preview`, {
    method: "POST",
    body,
  });
}

export function applyTimetableUpdate(input: {
  termId: string;
  baseUpdatedAt: string;
  filename: string;
  operations: Operation[];
}): Promise<TimetableTerm> {
  const body = new FormData();
  body.set("base_updated_at", input.baseUpdatedAt);
  body.set("filename", input.filename);
  body.set("operations", JSON.stringify(input.operations));
  return request<TimetableTerm>(`/api/v1/timetables/terms/${input.termId}/timetable/apply`, {
    method: "POST",
    body,
  });
}

export function setTimetableTermPublished(termId: string, published: boolean): Promise<TimetableTerm> {
  return request<TimetableTerm>(`/api/v1/timetables/terms/${termId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ published }),
  });
}

/** A new name for the semester. Its address for students — the slug — stays as it was. */
export function renameTimetableTerm(termId: string, name: string): Promise<TimetableTerm> {
  return request<TimetableTerm>(`/api/v1/timetables/terms/${termId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteTimetableTerm(termId: string): Promise<void> {
  return request<void>(`/api/v1/timetables/terms/${termId}`, { method: "DELETE" });
}

/** Quietest first, matching the levels the Student Hub accepts. */
export type AnnouncementLevel = "notice" | "important" | "urgent";

export type PlatformAnnouncement = {
  id?: string;
  icon: string;
  level?: AnnouncementLevel;
  /** "" for everybody in the semester; otherwise a cohort id. */
  cohortKey?: string;
  message: string;
};

/** A cohort the platform holds members for, so the editor can offer it by name. */
export type PlatformCohort = { key: string; name: string; students: number };

export async function fetchAnnouncements(
  termId: string,
): Promise<{ announcements: PlatformAnnouncement[]; icons: string[]; cohorts: PlatformCohort[] }> {
  return request<{ announcements: PlatformAnnouncement[]; icons: string[]; cohorts: PlatformCohort[] }>(
    `/api/v1/timetables/announcements?term=${encodeURIComponent(termId)}`,
  );
}

export async function saveAnnouncements(
  termId: string,
  announcements: PlatformAnnouncement[],
): Promise<PlatformAnnouncement[]> {
  const payload = await request<{ announcements: PlatformAnnouncement[] }>(
    `/api/v1/timetables/announcements?term=${encodeURIComponent(termId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      /*
       * The id goes back with each notice. It is what tells the platform this is the
       * same notice as before rather than a new one wearing its words — and a notice
       * that keeps its identity keeps every student's dismissal of it. Dropping the id
       * here, which is what this used to do, made saving a typo fix resurrect the whole
       * strip on every student's phone.
       */
        announcements: announcements.map(({ id, icon, level, cohortKey, message }) => ({
          id: id ?? "",
          icon,
          level: level ?? "notice",
          cohortKey: cohortKey ?? "",
          message,
        })),
      }),
    },
  );
  return payload.announcements;
}

