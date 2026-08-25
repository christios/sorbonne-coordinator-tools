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

export function importTimetableTerm(input: {
  name: string;
  timetable: File;
  /** One workbook per programme, plus the language groups. */
  enrolments: File[];
}): Promise<TimetableTerm> {
  const body = new FormData();
  body.set("name", input.name);
  body.set("timezone", "Asia/Dubai");
  body.set("timetable", input.timetable);
  input.enrolments.forEach((file) => body.append("enrolments", file));
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
  /** Optional: the group templates, when the export brought in a section nobody is on yet. */
  enrolments?: File[];
}): Promise<TimetableTerm> {
  const body = new FormData();
  body.set("base_updated_at", input.baseUpdatedAt);
  body.set("filename", input.filename);
  body.set("operations", JSON.stringify(input.operations));
  (input.enrolments ?? []).forEach((file) => body.append("enrolments", file));
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

export function deleteTimetableTerm(termId: string): Promise<void> {
  return request<void>(`/api/v1/timetables/terms/${termId}`, { method: "DELETE" });
}

export type PlatformAnnouncement = {
  id?: string;
  icon: string;
  message: string;
};

export async function fetchAnnouncements(): Promise<{ announcements: PlatformAnnouncement[]; icons: string[] }> {
  return request<{ announcements: PlatformAnnouncement[]; icons: string[] }>("/api/v1/timetables/announcements");
}

export async function saveAnnouncements(
  announcements: PlatformAnnouncement[],
): Promise<PlatformAnnouncement[]> {
  const payload = await request<{ announcements: PlatformAnnouncement[] }>("/api/v1/timetables/announcements", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      announcements: announcements.map(({ icon, message }) => ({ icon, message })),
    }),
  });
  return payload.announcements;
}

