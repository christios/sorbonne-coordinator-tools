/**
 * What happened to one dated class that the registrar's timetable does not say.
 *
 * A lecture cancelled, a tutorial taken by somebody else. Written on the calendar of a
 * CRN's record, keyed to the slot — term, CRN, date, start — and read wherever hours are
 * counted: the calendars, the teacher's record, Teacher hours. A sweep that moves the
 * class leaves the note beside an hour with no class in it, which the pages say out loud.
 */

import { apiFetch } from "@/services/http";
import { minutesOf } from "@/services/weekSchedule";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = "/api/v1/portal/session-changes";

export type ChangeKind = "cancelled" | "covered";

export type SessionChange = {
  id: string;
  termCode: string;
  crn: string;
  meetsOn: string;
  startsAt: string;
  endsAt: string;
  kind: ChangeKind;
  coverTeacherId: string;
  coverTeacherName: string;
  note: string;
  authorEmail: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionChangeInput = {
  termCode: string;
  crn: string;
  meetsOn: string;
  startsAt: string;
  endsAt: string;
  kind: ChangeKind;
  coverTeacherId?: string;
  coverTeacherName?: string;
  note?: string;
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function fetchSessionChanges(termCode: string): Promise<SessionChange[]> {
  return (await request<{ changes: SessionChange[] }>(`${BASE}?term=${encodeURIComponent(termCode)}`)).changes;
}

export function saveSessionChange(input: SessionChangeInput): Promise<SessionChange> {
  return request<SessionChange>(BASE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export function clearSessionChange(changeId: string): Promise<void> {
  return request<void>(`${BASE}/${encodeURIComponent(changeId)}`, { method: "DELETE" });
}

/** The key a note and a meeting share. */
export function slotKey(slot: { termCode: string; crn: string; meetsOn: string; startsAt: string }): string {
  return `${slot.termCode}|${slot.crn}|${slot.meetsOn}|${slot.startsAt.slice(0, 5)}`;
}

/** The note already on a slot, if any. */
export function noteOn(notes: SessionChange[], session: { termCode?: string; crn: string; date: string; start: string }): SessionChange | null {
  const key = slotKey({ termCode: session.termCode ?? "", crn: session.crn, meetsOn: session.date, startsAt: session.start });
  return notes.find((note) => slotKey(note) === key) ?? null;
}

/** How long a slot lasts, in hours — what a cancelled or covered class is worth. */
export function hoursOf(change: { startsAt: string; endsAt: string }): number {
  if (!change.endsAt) return 0;
  return Math.max(0, minutesOf(change.endsAt) - minutesOf(change.startsAt)) / 60;
}

/** One line saying what a note says, for lists and tooltips. */
export function describeChange(change: SessionChange): string {
  return change.kind === "cancelled" ? "Cancelled" : `Covered by ${change.coverTeacherName}`;
}

export type HourAdjustments = {
  /** Hours of this teacher's classes that were cancelled. */
  cancelled: number;
  /** Hours of this teacher's classes somebody else taught. */
  coveredByOthers: number;
  /** Hours this teacher taught in somebody else's class. */
  coveredForOthers: number;
  /** How many notes each of those comes from. */
  notes: number;
};

/**
 * What the notes do to one teacher's hours, given which CRNs are theirs in the planning.
 *
 * Cover is counted on both sides: the hour leaves the teacher who was planned and lands
 * on the one who stood in — matched by our id where the note has one, by name where it
 * has only that. The planning's hours themselves are not touched; these are a column
 * beside them, because a semester's cover and cancellations are a story about the
 * semester, not a correction to the request.
 */
export function adjustmentsFor(
  changes: SessionChange[],
  teacher: { id: string; name: string },
  ownCrns: ReadonlySet<string>,
  same: (left: string, right: string) => boolean,
): HourAdjustments {
  const held: HourAdjustments = { cancelled: 0, coveredByOthers: 0, coveredForOthers: 0, notes: 0 };
  for (const change of changes) {
    const hours = hoursOf(change);
    const mine = ownCrns.has(change.crn);
    const covering =
      change.kind === "covered" &&
      ((teacher.id && change.coverTeacherId === teacher.id) || (Boolean(teacher.name) && same(change.coverTeacherName, teacher.name)));
    if (mine && change.kind === "cancelled") {
      held.cancelled += hours;
      held.notes += 1;
    } else if (mine && change.kind === "covered" && !covering) {
      held.coveredByOthers += hours;
      held.notes += 1;
    } else if (covering && !mine) {
      held.coveredForOthers += hours;
      held.notes += 1;
    }
  }
  return held;
}
