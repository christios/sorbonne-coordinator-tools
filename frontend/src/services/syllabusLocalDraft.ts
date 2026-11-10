/**
 * Edits not saved yet, kept in this browser until they are (11 Nov 2026).
 *
 * The editor saves a moment after you stop typing. A refresh, a closed tab or a dropped
 * connection inside that moment lost the last words typed. Every unsaved change is
 * therefore also kept here, under the syllabus, and dropped once the server has it; a
 * syllabus opened with changes still kept here starts from them and saves them.
 *
 * They are kept with the revision they were made on. If the syllabus was saved elsewhere
 * since, saving them meets the usual "updated in another tab" question, so nothing is
 * overwritten unseen. A week on, kept changes are forgotten.
 */
import type { Syllabus } from "@/services/syllabi";

const PREFIX = "scen-syllabus-draft:";
export const LOCAL_DRAFT_TTL = 7 * 24 * 60 * 60_000;

type Kept = Pick<Syllabus, "revision" | "content" | "courseTitle" | "courseCode" | "academicYear"> & { at: number };

export function keepLocalDraft(draft: Syllabus, now = Date.now()): void {
  try {
    const kept: Kept = { revision: draft.revision, content: draft.content, courseTitle: draft.courseTitle, courseCode: draft.courseCode, academicYear: draft.academicYear, at: now };
    window.localStorage.setItem(PREFIX + draft.id, JSON.stringify(kept));
  } catch {
    // Storage full or turned off: the editor still saves as it always did.
  }
}

export function dropLocalDraft(id: string): void {
  try {
    window.localStorage.removeItem(PREFIX + id);
  } catch {
    // Nothing to drop.
  }
}

/** The syllabus as this browser last left it, unsaved; null when it kept nothing new. */
export function restoredDraft(syllabus: Syllabus, now = Date.now()): Syllabus | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + syllabus.id);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Kept;
    const stale = typeof kept?.at !== "number" || now - kept.at > LOCAL_DRAFT_TTL || typeof kept.revision !== "number";
    const unchanged =
      !stale &&
      JSON.stringify(kept.content) === JSON.stringify(syllabus.content) &&
      kept.courseTitle === syllabus.courseTitle &&
      kept.courseCode === syllabus.courseCode &&
      kept.academicYear === syllabus.academicYear;
    if (stale || unchanged) {
      dropLocalDraft(syllabus.id);
      return null;
    }
    return { ...syllabus, revision: kept.revision, content: kept.content, courseTitle: kept.courseTitle, courseCode: kept.courseCode, academicYear: kept.academicYear };
  } catch {
    return null;
  }
}
