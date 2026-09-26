/**
 * One teacher-hours table, for whichever stretch of the semester is being asked about.
 *
 * It lived inside the page, which was fine while the page only ever asked about the window
 * on screen. The export asks about every pay period of the semester in one go, and the
 * figures it writes have to be the figures the page would show if you clicked each period
 * in turn — so the answer has to be a function of the window rather than of what is
 * currently selected.
 *
 * Nothing here fetches. The page has already read the sections, the notes, the sheets and
 * the contracts; this arranges them, and arranging them a dozen times over is cheap.
 */

import { hoursTaught } from "@/services/hoursInPeriod";
import { periodEnd, periodLabel } from "@/services/payPeriods";
import { adjustmentsFor, type SessionChange } from "@/services/sessionChanges";
import {
  bookedInWindow,
  crnsByTeacher,
  loadRows,
  placeByCrn,
  registrarHoursFor,
  sameTeacher,
  taughtLoads,
  teacherLoads,
  type LoadRow,
} from "@/services/teacherLoad";
import type { ActiveTeacher, FacilityHours, FacilitySection } from "@/services/portalLists";
import type { RequestSheet } from "@/services/timetableExport";
import type { SubmittedTimeSheet, TeacherSummary } from "@/services/teachers";
import type { Dismissal } from "@/services/warningDismissals";
import { DEFAULT_APART, warningsFor } from "@/services/teacherWarnings";

/** Everything the table is made of, read once and asked many times. */
export type HoursSource = {
  sheets: RequestSheet[];
  teachers: ActiveTeacher[];
  /** Our own cancellations and covers for the term. */
  notes: SessionChange[];
  /** The registrar's dated meetings for every CRN we plan. */
  sections: FacilitySection[];
  /** The registrar's hours per section, for the whole-semester comparison. */
  booked: FacilityHours;
  /** Who our planning gives each CRN to, so a cover can be moved to whoever stood in. */
  owners: Map<string, { id: string; name: string }>;
  submitted: SubmittedTimeSheet[];
  contracts: Record<string, TeacherSummary>;
  /** The semester's academic year, "2026-2027", for the requisitions of that year; "" for all of them. */
  academicYear?: string;
  decided: Map<string, Dismissal>;
  /** How far apart two figures have to be before the department wants to hear about it. */
  threshold: number;
  /** Today, so "taught so far" means the same thing everywhere on one screen. */
  today: string;
};

export type Window = { from: string; to: string };

/**
 * Hours one teacher actually taught between two dates: what met, less the cancelled, plus
 * what they stood in for.
 */
export function hoursBetween(source: HoursSource, row: LoadRow, between: Window): number {
  const { hours } = hoursTaught({
    sections: source.sections,
    changes: source.notes,
    period: between,
    staffing: (crn) => source.owners.get(crn) ?? { id: "", name: "" },
  });
  const mine = row.active?.id || row.teacherId;
  const minutes = hours
    .filter((hour) => (mine ? hour.teacherId === mine : sameTeacher(hour.teacherName, row.teacher)))
    .reduce((sum, hour) => sum + hour.minutes, 0);
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * The table for one window.
 *
 * `whole` is not "the window happens to be the whole term": it is a different question.
 * Over the semester a row is the plan — a section is 21 hours, with no dates on it — and
 * over anything narrower it is what the registrar's dated meetings say happened. The two
 * are laid out the same way on purpose, so the table does not change shape when the
 * question narrows.
 */
export function hoursRowsFor(source: HoursSource, window: Window, whole: boolean): LoadRow[] {
  const { sheets, teachers, notes, sections, booked, owners, submitted, contracts, decided, threshold, today } = source;
  const planned = loadRows(teacherLoads(sheets), teachers, crnsByTeacher(sheets));
  const notesHere = notes.filter((note) => note.meetsOn >= window.from && note.meetsOn <= window.to);
  const { hours } = hoursTaught({
    sections,
    changes: notes,
    period: window,
    staffing: (crn) => owners.get(crn) ?? { id: "", name: "" },
  });
  const held = whole
    ? planned
    : loadRows(
        taughtLoads({
          hours,
          place: placeByCrn(sheets),
          sheets,
          everyone: planned.map((row) => ({ teacherId: row.teacherId, teacher: row.teacher })),
        }),
        teachers,
        crnsByTeacher(sheets),
      );
  return held.map((row) => {
    const adjusted = adjustmentsFor(notesHere, { id: row.active?.id ?? row.teacherId, name: row.teacher }, new Set(row.crns), sameTeacher);
    const mine = {
      ...row,
      cancelledHours: adjusted.cancelled,
      coverTaken: adjusted.coveredByOthers,
      coverGiven: adjusted.coveredForOthers,
      registrarHours: whole
        ? registrarHoursFor(booked, row.teacher, sameTeacher)
        : bookedInWindow(sections, row.teacher, window),
    };
    const partTime = row.active?.partTimeTeacherId ?? "";
    const paid = contracts[partTime];
    mine.adminHours = source.academicYear
      ? (paid?.byYear?.[source.academicYear]?.adminHours ?? 0)
      : (paid?.adminHours ?? 0);
    const claims = submitted
      .filter((sheet) => sheet.teacherId && sheet.teacherId === partTime)
      .map((sheet) => ({
        periodStart: sheet.periodStart,
        periodLabel: sheet.periodLabel || periodLabel(sheet.periodStart),
        claimed: sheet.claimedHours,
        taught: hoursBetween(source, row, { from: sheet.periodStart, to: periodEnd(sheet.periodStart) }),
      }));
    const warnings = warningsFor(
      {
        teacherKey: row.active?.id || row.teacherId || row.teacher,
        teacher: row.teacher,
        planned: row.total,
        registrar: mine.registrarHours,
        // Teaching only: admin hours are paid, not taught, and have nothing to meet.
        contracted: paid?.contractedHours ?? 0,
        taughtSoFar: hoursBetween(source, row, { from: "0000-01-01", to: today }),
        claims,
      },
      threshold,
    ).map((warning) => {
      const answered = decided.get(warning.key);
      return answered
        ? { ...warning, dismissed: true, dismissedBy: answered.byName || answered.byEmail, dismissedAt: answered.at }
        : warning;
    });
    return { ...mine, warnings };
  });
}

/** "2026-2027" for the portal's 262710: the two years a term code's first four digits name. */
export function academicYearOfTerm(termCode: string): string {
  const digits = termCode.replace(/\D/g, "");
  return digits.length >= 4 ? `20${digits.slice(0, 2)}-20${digits.slice(2, 4)}` : "";
}

export { DEFAULT_APART };
