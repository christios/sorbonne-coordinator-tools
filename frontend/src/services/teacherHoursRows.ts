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
  UNNAMED,
  type LoadRow,
  type TeacherLoad,
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

/** One CRN's hours for one teacher over a window, in hours. */
export type CrnWindowHours = {
  crn: string;
  courseCode: string;
  /** Everything the portal booked under it in the window, cancelled or not. */
  booked: number;
  /** What they were in the room for: the meetings less the cancelled and the covered, or the ones they covered. */
  taught: number;
  cancelled: number;
  /** Their class, taught by somebody standing in. */
  coveredByOthers: number;
  /** Somebody else's class they stood in for — the CRN is not theirs. */
  standingIn: boolean;
};

/**
 * A teacher's hours over a window, CRN by CRN: the rows a teacher's record draws when it is
 * opened from Teacher hours counting a pay period, so its lines add up to the row it was
 * opened from. Counted as `hoursBetween` counts them — the same meetings, the same notes.
 */
export function crnHoursBetween(input: {
  sections: FacilitySection[];
  notes: SessionChange[];
  window: Window;
  teacher: { id: string; name: string };
  /** Their own CRNs; any other CRN counts only for the classes they covered on it. */
  own: Set<string>;
}): CrnWindowHours[] {
  const { sections, notes, window, teacher, own } = input;
  // As `hoursBetween` decides it, so the lines add up to the row: by id where they have one.
  const isMe = (id: string, name: string) => (teacher.id ? id === teacher.id : sameTeacher(name, teacher.name));
  const { hours } = hoursTaught({
    sections,
    changes: notes,
    period: window,
    staffing: (crn) => (own.has(crn) ? teacher : { id: "", name: "" }),
  });
  const within = (day: string) => day >= window.from && day <= window.to;
  const cancelledAt = new Set(
    notes.filter((note) => note.kind === "cancelled" && within(note.meetsOn)).map((note) => `${note.crn}|${note.meetsOn}|${note.startsAt.slice(0, 5)}`),
  );
  const minutes = (from: string, to: string) => {
    const [a, b] = [from, to].map((at) => {
      const match = /^(\d{1,2}):(\d{2})/.exec(at.trim());
      return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
    });
    return Math.max(0, b - a);
  };
  const out: CrnWindowHours[] = [];
  for (const section of sections) {
    const mineHere = own.has(section.crn);
    const meetings = section.meetings.filter((meeting) => within(meeting.meetsOn));
    const theirs = hours.filter((hour) => hour.crn === section.crn);
    const taught = theirs.filter((hour) => isMe(hour.teacherId, hour.teacherName)).reduce((sum, hour) => sum + hour.minutes, 0);
    if (!mineHere && !taught) continue;
    out.push({
      crn: section.crn,
      courseCode: section.courseCode,
      booked: asHours(meetings.reduce((sum, meeting) => sum + minutes(meeting.startsAt, meeting.endsAt), 0)),
      taught: asHours(taught),
      cancelled: mineHere
        ? asHours(
            meetings
              .filter((meeting) => cancelledAt.has(`${section.crn}|${meeting.meetsOn}|${meeting.startsAt.slice(0, 5)}`))
              .reduce((sum, meeting) => sum + minutes(meeting.startsAt, meeting.endsAt), 0),
          )
        : 0,
      coveredByOthers: mineHere
        ? asHours(theirs.filter((hour) => hour.covered && !isMe(hour.teacherId, hour.teacherName)).reduce((sum, hour) => sum + hour.minutes, 0))
        : 0,
      standingIn: !mineHere,
    });
  }
  return out;
}

function asHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** One line of a teacher's hours per CRN: a CRN of theirs, or somebody else's they covered. */
export type CrnLine = {
  key: string;
  /** Empty for a section the planning has not given a CRN yet. */
  crn: string;
  courseCode: string;
  /** How the workbook names the sections under it: "Pre-calculus 1 G.2-TD". */
  sections: string[];
  /** The sheets they are on, which are the cohorts: "BSc-L1-S1". */
  cohorts: string[];
  /** The plan: what the sections under it are down for. Nought for a class they covered. */
  planned: number;
  /** What the portal booked under it — over the window, or the semester's booked total. */
  booked: number;
  cancelled: number;
  coveredByOthers: number;
  /** What they were in the room for, over the window. */
  taught: number;
  /** Whose class it was, where they stood in for somebody; "" for a CRN of theirs. */
  coveringFor: string;
};

/**
 * One teacher's row, CRN by CRN — what the pop-up beside a Teacher hours row lists.
 *
 * Over the whole semester the lines add up to the plan: every section the planning gives
 * them, CRN or not, at its hours. Over a window they add up to what the row says they
 * taught, counted from the same meetings and notes, each CRN once however many groups it
 * stands for. Either way the classes they covered for somebody else are lines of their own.
 */
export function crnDistribution(source: HoursSource, row: LoadRow, window: Window, whole: boolean): CrnLine[] {
  const me = { id: row.active?.id || row.teacherId, name: row.teacher };
  const keyOf = (name: string) => (name && name.toUpperCase() !== UNNAMED ? name.trim().toLowerCase() : "");
  const labelled = new Map<string, { sections: string[]; cohorts: string[]; courseCode: string; planned: number }>();
  const labelOf = (key: string) =>
    labelled.get(key) ?? labelled.set(key, { sections: [], cohorts: [], courseCode: "", planned: 0 }).get(key)!;
  const others = new Map<string, { sections: string[]; cohorts: string[]; courseCode: string }>();
  source.sheets.forEach((sheet) => {
    sheet.rows.forEach((line, index) => {
      if (line.retired) return;
      const courseCode = [line.subject, line.courseNumber].filter(Boolean).join("-");
      if (keyOf(line.teacher) !== keyOf(row.teacher)) {
        if (line.crn) {
          const held = others.get(line.crn) ?? { sections: [], cohorts: [], courseCode };
          if (!held.sections.includes(line.courseName)) held.sections.push(line.courseName);
          if (!held.cohorts.includes(sheet.title)) held.cohorts.push(sheet.title);
          others.set(line.crn, held);
        }
        return;
      }
      const held = labelOf(line.crn || `${sheet.title}|${index}`);
      held.courseCode = held.courseCode || courseCode;
      if (!held.sections.includes(line.courseName)) held.sections.push(line.courseName);
      if (!held.cohorts.includes(sheet.title)) held.cohorts.push(sheet.title);
      held.planned += Number(line.hours) || 0;
    });
  });
  const range = whole ? { from: "0000-01-01", to: "9999-12-31" } : window;
  const counted = new Map(
    crnHoursBetween({ sections: source.sections, notes: source.notes, window: range, teacher: me, own: new Set(row.crns) }).map(
      (entry) => [entry.crn, entry],
    ),
  );
  const round = (value: number) => Math.round(value * 100) / 100;
  const own: CrnLine[] = [...labelled.entries()].map(([key, held]) => {
    const crn = key.includes("|") ? "" : key;
    const met = crn ? counted.get(crn) : undefined;
    return {
      key,
      crn,
      courseCode: held.courseCode || met?.courseCode || "",
      sections: held.sections,
      cohorts: held.cohorts,
      planned: round(held.planned),
      booked: whole ? round(source.booked[crn]?.hours ?? 0) : (met?.booked ?? 0),
      cancelled: met?.cancelled ?? 0,
      coveredByOthers: met?.coveredByOthers ?? 0,
      taught: met?.taught ?? 0,
      coveringFor: "",
    };
  });
  const covering: CrnLine[] = [...counted.values()]
    .filter((entry) => entry.standingIn)
    .map((entry) => {
      const theirs = others.get(entry.crn);
      return {
        key: `cover|${entry.crn}`,
        crn: entry.crn,
        courseCode: theirs?.courseCode || entry.courseCode,
        sections: theirs?.sections ?? [],
        cohorts: theirs?.cohorts ?? [],
        planned: 0,
        booked: 0,
        cancelled: 0,
        coveredByOthers: 0,
        taught: entry.taught,
        coveringFor: source.owners.get(entry.crn)?.name || "somebody else",
      };
    });
  const order = (line: CrnLine) => `${line.cohorts[0] ?? "~"}|${line.courseCode}|${line.sections[0] ?? ""}|${line.crn}`;
  return [...own.sort((a, b) => order(a).localeCompare(order(b))), ...covering.sort((a, b) => order(a).localeCompare(order(b)))];
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
/**
 * Whoever stood in for somebody in the window and has nothing planned of their own.
 *
 * The semester's view lists the plan, and cover is no part of a plan — so Sachin Valera,
 * once his two Maths Readiness groups went to Ahmed Menaa, had taught 26 classes as cover
 * and had no row at all on the page's first view. A row of nothing planned, carrying the
 * cover it was given, is what he actually did.
 */
function coverOnly(planned: LoadRow[], notes: SessionChange[], sheets: RequestSheet[]): TeacherLoad[] {
  const listed = (id: string, name: string) =>
    planned.some((row) => (id && (row.active?.id === id || row.teacherId === id)) || sameTeacher(row.teacher, name));
  const found = new Map<string, TeacherLoad>();
  for (const note of notes) {
    const name = note.coverTeacherName?.trim() ?? "";
    if (note.kind !== "covered" || !name || listed(note.coverTeacherId, name)) continue;
    const key = note.coverTeacherId || name.toLowerCase();
    if (!found.has(key)) {
      found.set(key, { teacherId: note.coverTeacherId, teacher: name, bySheet: sheets.map(() => 0), byType: {}, total: 0, sections: 0 });
    }
  }
  return [...found.values()];
}

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
    ? [...planned, ...loadRows(coverOnly(planned, notesHere, sheets), teachers, crnsByTeacher(sheets))]
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
  // The plan, whatever the window, for the warnings: see below.
  const planOf = new Map(planned.map((row) => [row.teacherId || row.teacher.trim().toLowerCase(), row]));
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
    mine.requisitionedHours = source.academicYear
      ? (paid?.byYear?.[source.academicYear]?.teachingHours ?? 0)
      : (paid?.contractedHours ?? 0);
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
    /*
     * The warnings are the semester's, whatever the page is counting. They compare the
     * plan with the portal, the contract and the claims — facts about the term — and a
     * window counting October used to hold October's taught hours against the whole
     * contract, so picking a month changed which teachers were flagged and, with the
     * figures, the keys their dismissals were held against.
     */
    const plan = planOf.get(row.teacherId || row.teacher.trim().toLowerCase());
    const warnings = warningsFor(
      {
        teacherKey: row.active?.id || row.teacherId || row.teacher,
        teacher: row.teacher,
        planned: plan?.total ?? 0,
        registrar: registrarHoursFor(booked, row.teacher, sameTeacher),
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
