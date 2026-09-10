/**
 * What is wrong with each CRN of the register, as a warning on its own row.
 *
 * These were six counted lines in a band above the table — "3 sections the registrar
 * staffs differently" — which said how many and left you to open a list and match CRNs by
 * eye against the rows underneath. The Cohorts page settled this argument a while ago: a
 * fact about a row belongs on the row, and the band is for what has no row.
 *
 * Five of the six are about a CRN the department holds, so they land on it. The sixth —
 * a CRN the portal lists that we have NOT taken in — has no row by definition, and stays
 * above the table where the button that takes it in already is.
 */

import type { RegisterCheck } from "@/services/portalLists";

export type CrnWarningKind = "gone" | "unregistered" | "teacherDiffers" | "teacherUnnamed" | "collides";

export type CrnWarning = {
  kind: CrnWarningKind;
  /** The whole sentence, for the row and for anything that copies the table out. */
  text: string;
};

/**
 * How much each kind matters, worst first.
 *
 * The ladder is by consequence. A CRN the portal has dropped is a section that will not
 * happen; a CRN nobody registered in is a class with no students; a teacher disagreement
 * is a conversation; a collision is a timetable to argue about. The order decides the
 * colour of the row's pill, so it is written down rather than left to the order the
 * server happened to build the lists in.
 */
const RANK: Record<CrnWarningKind, number> = {
  gone: 4,
  unregistered: 3,
  teacherDiffers: 2,
  teacherUnnamed: 1,
  collides: 0,
};

export function warningsByCrn(report: RegisterCheck | undefined): Map<string, CrnWarning[]> {
  const found = new Map<string, CrnWarning[]>();
  if (!report) return found;
  const add = (crn: string, warning: CrnWarning) => {
    if (!crn) return;
    found.set(crn, [...(found.get(crn) ?? []), warning]);
  };

  for (const row of report.gone) {
    add(row.crn, { kind: "gone", text: `The portal has stopped listing it${row.usedBy ? `, and ${row.usedBy} card row(s) use it` : ""}` });
  }
  for (const row of report.unregistered) {
    add(row.crn, { kind: "unregistered", text: "On a card, and registered nowhere" });
  }
  for (const row of report.teacherDiffers) {
    add(row.crn, { kind: "teacherDiffers", text: `We say ${row.ours}, the registrar says ${row.theirs}` });
  }
  for (const row of report.teacherUnnamed) {
    add(row.crn, { kind: "teacherUnnamed", text: `The registrar staffs it ${row.theirs} and we have not` });
  }
  // One line per slot, because one section may sit in more than one of them.
  for (const row of report.collides) {
    const theirs = row.theirs.map((other) => other.courseCode || other.crn).join(", ");
    add(row.ourCrn, {
      kind: "collides",
      text: `${row.weekday} ${row.startsAt}–${row.endsAt} against ${theirs}`,
    });
  }

  for (const [crn, warnings] of found) {
    found.set(crn, [...warnings].sort((left, right) => RANK[right.kind] - RANK[left.kind]));
  }
  return found;
}

/** The worst thing wrong with a row, which is what its pill takes its colour from. */
export function worstOf(warnings: CrnWarning[]): CrnWarningKind | "" {
  if (!warnings.length) return "";
  return warnings.reduce((worst, warning) => (RANK[warning.kind] > RANK[worst] ? warning.kind : worst), warnings[0].kind);
}

/**
 * What the column sorts and filters on.
 *
 * The worst kind's own word rather than a count, because "which rows have a teacher
 * disagreement" is the question somebody filters this column to answer, and a number
 * cannot be filtered to it.
 */
export const WORDS: Record<CrnWarningKind, string> = {
  gone: "Gone from the portal",
  unregistered: "Registered nowhere",
  teacherDiffers: "Staffed differently",
  teacherUnnamed: "Staffed only by the registrar",
  collides: "Shares an hour",
};
