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
import { describeSweep, sweepFacilityTimetable } from "@/services/facilitySync";
import { pullFilter, studentIdOf, type PortalRoster, type PullProgress } from "@/services/scenRosters";
import { syncView } from "@/services/studentDatabase";

/** The four lists this application syncs: the students, and the three portal lists. */
/**
 * `timetable` is not a portal filter and has no rows: it is one sweep of the registrar's
 * own timetable, a section at a time. It rides in the run all the same, because a
 * coordinator asking "is everything up to date" means everything.
 */
export type SyncKind = "students" | ListKind | "timetable";

/** One thing that can be synced: a student view, a portal filter, or a semester's timetable. */
export type SyncTarget = {
  kind: SyncKind;
  /**
   * The view's or portal filter's id — what the server files the result under. For a
   * timetable it is the PORTAL TERM CODE, which is what the sweep is keyed on and what
   * the store files its sections under.
   */
  id: string;
  name: string;
  filter: Record<string, string[]>;
};

export type SyncOutcome = {
  report: SyncReport;
  /** Absent for a timetable sweep, which pulls meetings rather than a roster of people. */
  roster?: PortalRoster;
  /** What the pull was worth saying about itself, when it was not simply fine. */
  warning: string;
  /** Students only: whether the names reached this browser, and the copy on disk. */
  storage?: StorageReport | null;
  backup?: BackupOutcome | null;
};

/**
 * A sync that worked and still left the names behind.
 *
 * The table reads the names back from this browser's own storage, so a refused write is
 * a roster of ids — synced, and useless to read. Worth saying out loud beside the pull's
 * own warnings rather than discovering it in the table.
 */
function storageTrouble(storage: StorageReport | null): string {
  if (!storage) return "";
  if (!storage.stored) {
    return (
      "The students synced, but this browser had no room to keep their names, so the table " +
      "will show ids only. Use “Forget stored rosters” on the Students page, then sync again."
    );
  }
  if (!storage.shed.length) return "";
  const more = storage.shed.length > 1 ? ` and ${storage.shed.length - 1} more` : "";
  return `This browser was full, so it gave up ${storage.shed[0]}${more} to keep this roster.`;
}

/** A backup that quietly stopped working is worse than none: it is missed when needed. */
function backupTrouble(backup: BackupOutcome | null): string {
  if (!backup || backup.ok || backup.reason === "no_folder") return "";
  return backup.reason === "no_permission"
    ? "The history was not copied to your folder — Chrome needs you to allow it again."
    : "The history could not be written to your folder.";
}

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

/**
 * How long our own server gets to accept a list before the run stops waiting for it.
 *
 * Not in `apiFetch`. That is also the choke point for publication and for applying a
 * workbook, and a blanket deadline there would cut off long writes nobody is waiting on a
 * clock for. The reason the sync in particular needs one is that `drive()` awaits this
 * promise while the fifteen-second heartbeat goes on writing `beatAt` — so a stalled POST
 * is never abandoned, `clearRun` refuses because the run is still "running", the Clear
 * button stays hidden, and there is no way out but clearing the browser's storage.
 */
const SERVER_BUDGET_MS = 90_000;

export class ServerTooSlow extends Error {
  readonly code = "server_slow";

  constructor() {
    super(
      "Our own server did not accept this list within a minute and a half, so the run " +
        "stopped waiting for it. Nothing was lost — try the sync again.",
    );
    this.name = "ServerTooSlow";
  }
}

export async function syncTarget(
  target: SyncTarget,
  onProgress?: (progress: PullProgress) => void,
  budgetMs: number = SERVER_BUDGET_MS,
): Promise<SyncOutcome> {
  /*
   * The budget covers the leg to OUR server and nothing else.
   *
   * Not the portal's answer, which has its own ten-minute patience and its own reasons to
   * be slow; and not the writes to this browser's own disk below, which cannot hang on a
   * network. Just the one call the run has no way to give up on by itself.
   */
  const accepted = async <T,>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const signal = AbortSignal.timeout(budgetMs);
    try {
      return await work(signal);
    } catch (error) {
      // The abort surfaces as a DOMException about an operation nobody asked about. Say
      // what actually happened instead, and give it a word the run can group failures by.
      if (signal.aborted) throw new ServerTooSlow();
      throw error;
    }
  };

  /*
   * The timetable first, because it is not a filter pull at all and everything below
   * assumes one. It has its own budget too: `pullTimetable` is a hundred and sixty calls
   * inside the extension, and wrapping it in the ninety seconds our own server gets would
   * abandon a sweep that is working perfectly.
   */
  if (target.kind === "timetable") {
    const sweep = await sweepFacilityTimetable(target.id, { theirsToo: true }, onProgress);
    return {
      // `seen` is what the step shows: sections the registrar answered for. Silences are
      // not failures and not absences, so they travel in the warning instead of the count.
      report: { seen: sweep.answered, added: 0, missing: 0, syncedAt: new Date().toISOString() },
      // Only what went wrong. How much of the semester is booked is a fact about the
      // semester, and it is said on Groups & CRNs where it qualifies the clash count.
      warning: describeSweep(sweep),
    };
  }

  const roster = await pullFilter(target.filter, { name: target.name, kind: target.kind }, onProgress);
  const warning = describePullWarning(roster.warning, roster.count, roster.expect);

  if (target.kind === "students") {
    const report = await accepted((signal) =>
      syncView(target.id, roster.rows.map(studentIdOf).filter(Boolean), signal),
    );
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
    return { report, roster, warning: [warning, storageTrouble(storage), backupTrouble(backup)].filter(Boolean).join(" "), storage, backup };
  }

  checkKind(roster, target.kind);
  if (target.kind === "courses") {
    const rows = roster.rows.map(courseRowOf).filter((row) => row.crn);
    return { report: await accepted((signal) => syncCourses(target.id, rows, signal)), roster, warning };
  }
  if (target.kind === "teachers") {
    const rows = roster.rows.map(teacherRowOf).filter((row) => row.teacherId);
    return { report: await accepted((signal) => syncTeachers(target.id, rows, signal)), roster, warning };
  }
  const termCode = termCodeOf(roster.term, roster.rows);
  if (!termCode) throw new Error("The portal did not say which term these registrations are for.");
  const rows = roster.rows.map(registrationRowOf).filter((row) => row.studentId && row.crn);
  return { report: await accepted((signal) => syncRegistrations(target.id, termCode, rows, signal)), roster, warning };
}