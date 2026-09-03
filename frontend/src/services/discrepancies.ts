/**
 * Where the portal and the department disagree about a student.
 *
 * Admissions keeps changing statuses and majors; the department keeps cohorts and groups
 * that were built on what those were at the time. Nothing here told anybody when the two
 * had drifted apart — a withdrawn student kept a seat in a group until somebody noticed at
 * timetable time.
 *
 * The rules are the coordinators' and shared: "warn when STST_CODE changes to WD",
 * "warn when MAJOR_CODE_DESC differs from the cohort's program". The evidence is this
 * browser's — the pull history, which records every change with its before and after —
 * because the server is never told a name, so the judging has to happen where the names
 * are.
 *
 * Pure: everything is passed in, nothing is fetched. That is what makes the rules
 * testable one at a time.
 */

import { rowText } from "@/services/copyCells";

export type RuleKind = "changed" | "changed_to" | "is" | "differs";

export type Rule = {
  id: string;
  field: string;
  kind: RuleKind;
  /** Portal values; meaningful for `changed_to` and `is`. */
  values: string[];
};

/** One recorded change to one student's record, from the pull history. */
export type Change = { at: number; field: string; from: string; to: string };

export type Placed = {
  studentId: string;
  cohortId: string | null;
  /** ISO moment of placement; empty for a placement made before this was recorded. */
  cohortSince: string;
};

export type Expectation = { id: string; program: string; yearLevel: string };

export type Warning = {
  /**
   * Stable across recomputations for as long as the same fact holds, so a dismissal can
   * point at it — and changes on its own when the fact does, which is what lets a
   * dismissal expire "when the record changes again" without any bookkeeping.
   */
  key: string;
  studentId: string;
  ruleId: string;
  kind: RuleKind | "unplaced" | "no_baseline";
  field: string;
  /** For a change: what it was and what it became, and when. */
  from?: string;
  to?: string;
  at?: number;
  /** For a state: what it is now; and for `differs`, what the cohort expected. */
  value?: string;
  expected?: string;
};

/** What the page shows for one field, so a warning reads as a sentence. */
export const FIELD_LABELS: Record<string, string> = {
  STST_CODE: "student status",
  ESTS_CODE: "enrolment status",
  MAJOR_CODE_DESC: "major",
  YEARLEVEL_CODE: "year level",
  FULL_NAME: "name",
  PSUAD_EMAIL: "e-mail",
  PROGRAM_CODE: "program",
};

export function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field.toLowerCase().replace(/_/g, " ");
}

/** The cohort's own value for a field a `differs` rule can read, or "" when it has none. */
function expectedOf(cohort: Expectation | null, field: string): string {
  if (!cohort) return "";
  if (field === "MAJOR_CODE_DESC") return cohort.program;
  if (field === "YEARLEVEL_CODE") return cohort.yearLevel;
  return "";
}

const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * The warnings for the students of one cohort.
 *
 * Change rules are measured from the moment of placement: the record as it stood when
 * the coordinator put the student in is the one they accepted, and anything after is
 * news. A student with no recorded placement gets one warning saying so rather than
 * every change they have ever had, or none.
 */
export function warningsForCohort(input: {
  cohort: Expectation;
  students: Placed[];
  rules: Rule[];
  current: (studentId: string) => Record<string, string> | undefined;
  changes: (studentId: string) => Change[];
}): Warning[] {
  const out: Warning[] = [];
  const members = input.students.filter((student) => student.cohortId === input.cohort.id);
  const changeRules = input.rules.filter((rule) => rule.kind === "changed" || rule.kind === "changed_to");

  for (const student of members) {
    const now = input.current(student.studentId) ?? {};
    const placedAt = student.cohortSince ? Date.parse(student.cohortSince) : NaN;

    if (changeRules.length && Number.isNaN(placedAt)) {
      out.push({
        key: `${student.studentId}:no_baseline`,
        studentId: student.studentId,
        ruleId: "",
        kind: "no_baseline",
        field: "",
      });
    }

    for (const rule of input.rules) {
      if (rule.kind === "is") {
        const value = now[rule.field] ?? "";
        if (value && rule.values.some((wanted) => same(wanted, value))) {
          out.push({
            key: `${student.studentId}:${rule.id}:${value}`,
            studentId: student.studentId,
            ruleId: rule.id,
            kind: "is",
            field: rule.field,
            value,
          });
        }
        continue;
      }

      if (rule.kind === "differs") {
        const expected = expectedOf(input.cohort, rule.field);
        const value = now[rule.field] ?? "";
        // A cohort that states no expectation has nothing to differ from; a student we
        // hold no record for cannot differ either — that is the no-name case, not this.
        if (expected && value && !same(expected, value)) {
          out.push({
            key: `${student.studentId}:${rule.id}:${value}≠${expected}`,
            studentId: student.studentId,
            ruleId: rule.id,
            kind: "differs",
            field: rule.field,
            value,
            expected,
          });
        }
        continue;
      }

      if (Number.isNaN(placedAt)) continue;
      for (const change of input.changes(student.studentId)) {
        if (change.field !== rule.field || change.at < placedAt) continue;
        if (rule.kind === "changed_to" && !rule.values.some((wanted) => same(wanted, change.to))) continue;
        out.push({
          key: `${student.studentId}:${rule.id}:${change.from}→${change.to}@${change.at}`,
          studentId: student.studentId,
          ruleId: rule.id,
          kind: rule.kind,
          field: rule.field,
          from: change.from,
          to: change.to,
          at: change.at,
        });
      }
    }
  }
  return out;
}

/**
 * The reverse: students in no cohort who look, by the department's own rules, like they
 * should be in one.
 *
 * "Looks fine" is defined by the same `is` rules that define trouble — a student none of
 * them fires for is one admissions considers in good standing, and the department has
 * nowhere for them. Anyone a rule does fire for is not a placement candidate, and is
 * left out rather than listed twice.
 */
export function unplacedWarnings(input: {
  students: Placed[];
  rules: Rule[];
  current: (studentId: string) => Record<string, string> | undefined;
}): Warning[] {
  const trouble = input.rules.filter((rule) => rule.kind === "is");
  const out: Warning[] = [];
  for (const student of input.students) {
    if (student.cohortId) continue;
    const now = input.current(student.studentId);
    // No record at all is not "in good standing": it is nothing to judge by.
    if (!now) continue;
    const inTrouble = trouble.some((rule) => {
      const value = now[rule.field] ?? "";
      return value && rule.values.some((wanted) => same(wanted, value));
    });
    if (inTrouble) continue;
    out.push({
      key: `${student.studentId}:unplaced`,
      studentId: student.studentId,
      ruleId: "",
      kind: "unplaced",
      field: "",
    });
  }
  return out;
}

/** A warning as a sentence, the way the row shows it. */
export function describeWarning(warning: Warning): string {
  const field = labelOf(warning.field);
  switch (warning.kind) {
    case "changed":
      return `${field} changed: ${warning.from || "—"} → ${warning.to || "—"}`;
    case "changed_to":
      return `${field} changed to ${warning.to}${warning.from ? ` (was ${warning.from})` : ""}`;
    case "is":
      return `${field} is ${warning.value}`;
    case "differs":
      return `${field} is ${warning.value}, cohort expects ${warning.expected}`;
    case "unplaced":
      return "in no cohort, and nothing about them says they should not be";
    case "no_baseline":
      return "placed before the moment of placement was recorded — changes cannot be judged";
  }
}

/** The whole list as a spreadsheet block, for handing to admissions. */
export function warningsText(rows: { studentId: string; name: string; warnings: Warning[] }[]): string {
  return [
    rowText(["Id", "Student", "Warning"]),
    ...rows.flatMap((row) =>
      row.warnings.map((warning) => rowText([row.studentId, row.name, describeWarning(warning)])),
    ),
  ].join("\n");
}
