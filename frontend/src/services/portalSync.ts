/**
 * One sync, wherever it was asked for.
 *
 * A page's own Sync button and the header's "Sync everything" must do the same thing —
 * the same pull, the same rows kept, the same history written — or the two would drift
 * and only one of them would be right. So the act itself lives here, and both callers
 * are only ways of asking for it.
 *
 * The pull can only be made by the extension, and what it returns carries names. Those
 * stay in this browser: the students' names go to this browser's own storage and its
 * pull history, and what reaches our server is a student id, a CRN, a course, a teacher.
 */

import { backUpHistory, type BackupOutcome } from "@/services/historyBackup";
import {
  type ListKind,
  type SyncReport,
  courseRowOf,
  describePullWarning,
  registrationRowOf,
  syncCourses,
  syncRegistrations,
  syncTeachers,
  teacherRowOf,
  termCodeOf,
} from "@/services/portalLists";
import { recordPull } from "@/services/pullHistory";
import { rememberPull, rememberSync, storageReport, type StorageReport } from "@/services/rosterStore";
import { pullFilter, studentIdOf, type PortalRoster, type PullProgress } from "@/services/scenRosters";
import { syncView } from "@/services/studentDatabase";

/** The four lists this application syncs: the students, and the three portal lists. */
export type SyncKind = "students" | ListKind;

/** One thing that can be synced: a student view, or a portal filter of one of the lists. */
export type SyncTarget = {
  kind: SyncKind;
  /** The view's or portal filter's id — what the server files the result under. */
  id: string;
  name: string;
  filter: Record<string, string[]>;
};

export type SyncOutcome = {
  report: SyncReport;
  roster: PortalRoster;
  /** What the pull was worth saying about itself, when it was not simply fine. */
  warning: string;
  /** Students only: whether the names reached this browser, and the copy on disk. */
  storage?: StorageReport | null;
  backup?: BackupOutcome | null;
};

/**
 * An extension older than this page knows only the student grid and answers with
 * students whatever it was asked; those must not land as courses or teachers.
 */
function checkKind(roster: PortalRoster, kind: SyncKind): void {
  if (roster.kind !== kind) {
    throw new Error(
      "The SCEN Rosters extension answered with a list of students, so it is older than this page. Load version 1.6.0 or later and reload.",
    );
  }
}

export async function syncTarget(
  target: SyncTarget,
  onProgress?: (progress: PullProgress) => void,
): Promise<SyncOutcome> {
  const roster = await pullFilter(target.filter, { name: target.name, kind: target.kind }, onProgress);
  const warning = describePullWarning(roster.warning, roster.count, roster.expect);

  if (target.kind === "students") {
    const report = await syncView(target.id, roster.rows.map(studentIdOf).filter(Boolean));
    // Awaited, not fired off: the browser answers for its own disk asynchronously, and
    // what is reported back is only true once the write has actually landed.
    await rememberPull({ ...roster, presetId: target.id });
    const storage = storageReport();
    rememberSync(target.id, report.syncedAt);
    // One history per view, so a student's changes read against the same question.
    await recordPull(target.id, roster.rows, roster.fetchedAt);
    /*
     * The history is the one thing here that cannot be rebuilt from the server, so the
     * copy on disk is rewritten while we know it has just changed. It does nothing until
     * a folder has been chosen, and a failure must not fail the sync — the students are
     * synced either way.
     */
    const backup = await backUpHistory();
    return { report, roster, warning, storage, backup };
  }

  checkKind(roster, target.kind);
  if (target.kind === "courses") {
    const rows = roster.rows.map(courseRowOf).filter((row) => row.crn);
    return { report: await syncCourses(target.id, rows), roster, warning };
  }
  if (target.kind === "teachers") {
    const rows = roster.rows.map(teacherRowOf).filter((row) => row.teacherId);
    return { report: await syncTeachers(target.id, rows), roster, warning };
  }
  const termCode = termCodeOf(roster.term, roster.rows);
  if (!termCode) throw new Error("The portal did not say which term these registrations are for.");
  const rows = roster.rows.map(registrationRowOf).filter((row) => row.studentId && row.crn);
  return { report: await syncRegistrations(target.id, termCode, rows), roster, warning };
}