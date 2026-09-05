/**
 * Where the portal and the department disagree about a student.
 *
 * Admissions keeps changing statuses and majors; the department keeps cohorts and groups
 * that were built on what those were at the time. Nothing here told anybody when the two
 * had drifted apart — a withdrawn student kept a seat in a group until somebody noticed at
 * timetable time.
 *
 * The rules are the coordinators' and shared: "warn when STST_CODE changes to WD",
 * "warn when MAJOR_CODE differs from the cohort's". The evidence is this browser's — the
 * pull history, which records every change with its before and after — because the
 * server is never told a name, so the judging has to happen where the names are.
 *
 * A rule names a portal code; a pull may carry the code, the description the portal
 * shows for it, or both. DEPT_CODE is SCEN and DEPT_DESC is "Science and Engineering",
 * and the rule must fire either way, so values are read through the portal's own code
 * table when the code itself is not on the row.
 *
 * Pure: everything is passed in, nothing is fetched. That is what makes the rules
 * testable one at a time.
 */

import { rowText } from "@/services/copyCells";

export type RuleKind = "changed" | "changed_to" | "is" | "is_not" | "differs" | "belongs";

export type Rule = {
  id: string;
  field: string;
  kind: RuleKind;
  /** Portal values; meaningful for `changed_to`, `is` and `is_not`. */
  values: string[];
  /** The cohort the rule is for; empty, or absent, for every cohort. */
  cohortId?: string;
};

/** The rules that apply to one cohort: the shared ones and its own. */
export function rulesFor(rules: Rule[], cohortId: string): Rule[] {
  return rules.filter((rule) => !rule.cohortId || rule.cohortId === cohortId);
}

/** The rules that apply everywhere — what the students in no cohort are judged by. */
export function sharedRules(rules: Rule[]): Rule[] {
  return rules.filter((rule) => !rule.cohortId);
}

/** One recorded change to one student's record, from the pull history. */
export type Change = { at: number; field: string; from: string; to: string };

export type Placed = {
  studentId: string;
  cohortId: string | null;
  /** ISO moment of placement; empty for a placement made before this was recorded. */
  cohortSince: string;
};

/** What a cohort expects, as the portal codes it. Empty lists expect nothing. */
export type Expectation = { id: string; majors: string[]; terms: string[]; yearLevel: string };

/** The portal's code table for a field — `{ value: "SCEN", label: "Science and Engineering" }`. */
export type Options = (field: string) => { value: string; label: string }[];

const NO_OPTIONS: Options = () => [];

/**
 * The one field that is this application's rather than the portal's: whether the last
 * sync still found the student. A rule may name it like any other.
 */
export const STATUS_FIELD = "STATUS";
export const STATUS_OPTIONS = [
  { value: "in_portal", label: "In portal" },
  { value: "not_in_portal", label: "Not in portal" },
];

export type Warning = {
  /**
   * Stable across recomputations for as long as the same fact holds, so a dismissal can
   * point at it — and changes on its own when the fact does, which is what lets a
   * dismissal expire "when the record changes again" without any bookkeeping.
   */
  key: string;
  studentId: string;
  ruleId: string;
  kind: RuleKind | "unplaced" | "no_baseline" | "registration";
  field: string;
  /** For a change: what it was and what it became, and when. */
  from?: string;
  to?: string;
  at?: number;
  /** For a state: what it is now; and for `differs`, what the cohort expected. */
  value?: string;
  expected?: string;
  /** Set by the page when the coordinator has dismissed it and asked to see the dismissed. */
  dismissed?: boolean;
};

/** What the page shows for one field, so a warning reads as a sentence. */
export const FIELD_LABELS: Record<string, string> = {
  STST_CODE: "student status",
  ESTS_CODE: "enrolment status",
  MAJOR_CODE_DESC: "major",
  MAJOR_CODE: "major",
  YEARLEVEL_CODE: "year level",
  FULL_NAME: "name",
  PSUAD_EMAIL: "e-mail",
  PROGRAM_CODE: "program",
  DEPT_CODE: "department",
  DEPT_DESC: "department",
  TERM_CODE: "term",
  [STATUS_FIELD]: "status",
};

export function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field.toLowerCase().replace(/_/g, " ");
}

/**
 * The field names a pull might carry the same fact under: the code, or the description
 * the portal shows beside it. MAJOR_CODE and MAJOR_CODE_DESC; DEPT_CODE and DEPT_DESC.
 */
export function twins(field: string): string[] {
  const out = [field];
  if (field.endsWith("_CODE")) out.push(`${field}_DESC`, field.replace(/_CODE$/, "_DESC"));
  else if (field.endsWith("_DESC")) out.push(field.replace(/_DESC$/, "_CODE"), field.replace(/_CODE_DESC$/, "_CODE"));
  return [...new Set(out)];
}

const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

/** The portal's label for a code, or the code itself when the table does not know it. */
function labelFor(field: string, code: string, options: Options): string {
  return options(field).find((option) => same(option.value, code))?.label ?? code;
}

/**
 * Whether a value on a row means one of the wanted codes.
 *
 * Wanted is what the rule or the cohort says, usually a code; the value is what the pull
 * carried, which may be the code or the description. Either spelling of either side
 * counts, so "SCEN" is "Science and Engineering" and back.
 */
function meansOneOf(field: string, wanted: string[], value: string, options: Options): boolean {
  if (!value) return false;
  return wanted.some(
    (code) =>
      same(code, value) || same(labelFor(field, code, options), value) || same(code, labelFor(field, value, options)),
  );
}

/**
 * A row's value for a field: the code when the pull carried it, else what the row says
 * under the description it travels with, read back to a code where the table allows.
 */
export function valueOf(now: Record<string, string>, field: string, options: Options = NO_OPTIONS): string {
  for (const name of twins(field)) {
    const held = now[name] ?? "";
    if (!held) continue;
    if (name === field) return held;
    const known = options(field).find((option) => same(option.label, held));
    return known?.value ?? held;
  }
  return "";
}

/** The cohort's own values for a field a `differs` rule can read; empty when it states none. */
function expectedOf(cohort: Expectation | null, field: string): string[] {
  if (!cohort) return [];
  if (field === "MAJOR_CODE") return cohort.majors;
  if (field === "TERM_CODE") return cohort.terms;
  if (field === "YEARLEVEL_CODE") return cohort.yearLevel ? [cohort.yearLevel] : [];
  return [];
}

/** The field a `differs` rule on a description compares by — the code beside it. */
const codeField = (field: string) => (field === "MAJOR_CODE_DESC" ? "MAJOR_CODE" : field);

/**
 * Whether a state rule fires on a current value.
 *
 * `is` names the values that are trouble; `is_not` names the values that are fine, so
 * anything else is — including a code admissions invented last week that nobody here
 * has seen. A student with no value for the field is not judged either way.
 */
function stateFires(rule: Rule, value: string, options: Options): boolean {
  if (!value) return false;
  const listed = meansOneOf(rule.field, rule.values, value, options);
  return rule.kind === "is" ? listed : rule.kind === "is_not" ? !listed : false;
}

/**
 * The changes of one student the rule's field is about, under whichever name they were
 * kept. A value appearing from nothing is not one of them: that is a column the pull
 * started carrying — MAJOR_CODE, the day the extension began asking for it — not a
 * student whose major moved. The same for a value vanishing.
 */
function changesTo(field: string, changes: Change[]): Change[] {
  const names = new Set(twins(field));
  return changes.filter((change) => names.has(change.field) && change.from.trim() !== "" && change.to.trim() !== "");
}

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
  options?: Options;
}): Warning[] {
  const out: Warning[] = [];
  const options = input.options ?? NO_OPTIONS;
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
      if (rule.kind === "is" || rule.kind === "is_not") {
        const value = valueOf(now, rule.field, options);
        if (stateFires(rule, value, options)) {
          out.push({
            key: `${student.studentId}:${rule.id}:${value}`,
            studentId: student.studentId,
            ruleId: rule.id,
            kind: rule.kind,
            field: rule.field,
            value,
            // What was expected instead, so the row can say so.
            expected: rule.kind === "is_not" ? rule.values.join(" or ") : undefined,
          });
        }
        continue;
      }

      if (rule.kind === "differs") {
        const field = codeField(rule.field);
        const expected = expectedOf(input.cohort, field);
        const value = valueOf(now, field, options);
        // A cohort that states no expectation has nothing to differ from; a student we
        // hold no record for cannot differ either — that is the no-name case, not this.
        if (expected.length && value && !meansOneOf(field, expected, value, options)) {
          out.push({
            key: `${student.studentId}:${rule.id}:${value}≠${expected.join("|")}`,
            studentId: student.studentId,
            ruleId: rule.id,
            kind: "differs",
            field: rule.field,
            value,
            expected: expected.join(" or "),
          });
        }
        continue;
      }

      if (Number.isNaN(placedAt)) continue;
      for (const change of changesTo(rule.field, input.changes(student.studentId))) {
        if (change.at < placedAt) continue;
        if (rule.kind === "changed_to" && !meansOneOf(rule.field, rule.values, change.to, options)) continue;
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
  options?: Options;
}): Warning[] {
  const options = input.options ?? NO_OPTIONS;
  const trouble = input.rules.filter((rule) => rule.kind === "is" || rule.kind === "is_not");
  const out: Warning[] = [];
  for (const student of input.students) {
    if (student.cohortId) continue;
    const now = input.current(student.studentId);
    // No record at all is not "in good standing": it is nothing to judge by.
    if (!now) continue;
    const inTrouble = trouble.some((rule) => stateFires(rule, valueOf(now, rule.field, options), options));
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

/**
 * A student who belongs to a cohort by its own expectations and is not in it.
 *
 * The other rules judge a cohort's own students; a `belongs` rule looks the other way,
 * at everyone outside the cohort whose record says what the cohort expects — the major,
 * and the term and year level when the cohort states them. That is the student admissions
 * has just made the department's, and equally the one somebody took out of the cohort by
 * hand while nothing about them changed. When the history holds the change that brought
 * them in, the line says so; a student the portal has dropped is not listed.
 */
export type Arrival = {
  /** Holds still while the fact does, so a dismissal can point at it. */
  key: string;
  ruleId: string;
  studentId: string;
  /** Where they are now: another cohort, or none. */
  cohortId: string | null;
  /** Their major, as the row says it. */
  major: string;
  /** The change that brought them in, when the history has one. */
  moved?: { at: number; from: string; to: string };
};

export function arrivalsFor(input: {
  cohort: Expectation;
  rules: Rule[];
  students: Placed[];
  current: (studentId: string) => Record<string, string> | undefined;
  changes: (studentId: string) => Change[];
  options?: Options;
}): Arrival[] {
  const options = input.options ?? NO_OPTIONS;
  const { majors, terms, yearLevel } = input.cohort;
  const rule = input.rules.find((candidate) => candidate.kind === "belongs");
  if (!rule || !majors.length) return [];
  const out: Arrival[] = [];
  for (const student of input.students) {
    if (student.cohortId === input.cohort.id) continue;
    const now = input.current(student.studentId);
    if (!now || now[STATUS_FIELD] === "not_in_portal") continue;
    const major = valueOf(now, "MAJOR_CODE", options);
    if (!meansOneOf("MAJOR_CODE", majors, major, options)) continue;
    if (terms.length && !meansOneOf("TERM_CODE", terms, valueOf(now, "TERM_CODE", options), options)) continue;
    if (yearLevel && !meansOneOf("YEARLEVEL_CODE", [yearLevel], valueOf(now, "YEARLEVEL_CODE", options), options)) continue;
    const moved = changesTo("MAJOR_CODE", input.changes(student.studentId))
      .filter((change) => meansOneOf("MAJOR_CODE", majors, change.to, options) && !meansOneOf("MAJOR_CODE", majors, change.from, options))
      .sort((left, right) => right.at - left.at)[0];
    out.push({
      key: `${input.cohort.id}:${student.studentId}:${rule.id}:${major}:${student.cohortId ?? ""}${moved ? `@${moved.at}` : ""}`,
      ruleId: rule.id,
      studentId: student.studentId,
      cohortId: student.cohortId,
      major,
      moved: moved ? { at: moved.at, from: moved.from, to: moved.to } : undefined,
    });
  }
  return out.sort((left, right) => (right.moved?.at ?? 0) - (left.moved?.at ?? 0) || left.studentId.localeCompare(right.studentId));
}

/**
 * The rules no pull can answer: their field, under any of its names, is on no row this
 * browser holds. A rule on DEPT_CODE is silent, not satisfied, when the pulls carry
 * neither DEPT_CODE nor DEPT_DESC — and the page should say so rather than show nothing.
 */
export function unjudgeable(rules: Rule[], carried: Set<string>): Rule[] {
  return rules.filter((rule) => !twins(rule.field).some((name) => carried.has(name)));
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
    case "is_not":
      return `${field} is ${warning.value}, not ${warning.expected}`;
    case "differs":
      return `${field} is ${warning.value}, cohort expects ${warning.expected}`;
    case "belongs":
      // Never a row's warning: such a student is not in the cohort. Said for completeness.
      return "belongs to the cohort by its expectations, and is not in it";
    case "unplaced":
      return "in no cohort, and nothing about them says they should not be";
    case "no_baseline":
      return "placed before the moment of placement was recorded — changes cannot be judged";
    case "registration":
      // Written in full by registrationWarnings, since the sentence is the portal's fact.
      return warning.value ?? "registration differs from the group";
  }
}

/**
 * The registrar's registrations held against our groups, as warnings.
 *
 * The comparison itself is the server's — it holds both the groups and the registrations,
 * as ids and CRNs — so this only gives each difference the shape a warning has: a key
 * that holds still while the fact does, so a coordinator who has seen "registered in
 * 23653, group says 23652" and decided it is fine can dismiss it until it changes.
 */
export function registrationWarnings<
  M extends {
    studentId: string;
    termCode: string;
    courseCode: string;
    kind: "missing" | "wrong" | "extra" | "unplaced";
    expected: string;
    registered: string[];
  },
>(mismatches: M[], describe: (mismatch: M) => string): Warning[] {
  return mismatches.map((mismatch) => ({
    key: `registration|${mismatch.studentId}|${mismatch.termCode}|${mismatch.courseCode}|${mismatch.kind}|${mismatch.expected}|${mismatch.registered.join("+")}`,
    studentId: mismatch.studentId,
    ruleId: "registration",
    kind: "registration",
    field: "registration",
    value: describe(mismatch),
    expected: mismatch.expected,
  }));
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
