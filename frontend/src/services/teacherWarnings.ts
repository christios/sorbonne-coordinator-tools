/**
 * Where a teacher's hours disagree with themselves.
 *
 * The same person's teaching is written down in four places and none of them is wrong on
 * purpose. We plan it on the timetable sheets; the registrar books it on the portal; a
 * requisition contracts it; and a submitted timesheet claims it. Most of the time the
 * four agree to within a rounding, and a page that said so would be a page of pills
 * nobody reads.
 *
 * So only a real gap is a warning, and how big a gap is real is the department's to set
 * — a check with a threshold, like the collision check, defaulting to two hours. Below
 * that sit all the explainable differences: a class that ran short, a half-hour of cover,
 * a requisition rounded to the nearest whole.
 *
 * Each comparison runs only where both its figures exist. A full-time teacher has no
 * requisition and no timesheet, and judging them against an absent number would invent a
 * problem out of a blank.
 *
 * The key is the fact, not the row: it carries the two numbers, so a dismissal lasts
 * exactly as long as the disagreement somebody looked at and changes the moment either
 * side moves. That is the same rule the cohorts page's warnings live by, and the reason
 * neither of them needs anything to expire a dismissal.
 */

export type TeacherWarningKind =
  | "plan_vs_registrar"
  | "plan_vs_contract"
  | "claim_vs_taught"
  | "contract_nearly_spent";

/**
 * How loudly a disagreement should say itself.
 *
 * Measured against the department's own threshold rather than in absolute hours, because
 * the threshold is already its statement of what is worth mentioning: a gap barely over
 * it is a thing to look at some time, and one several times over it is a thing to look at
 * now. A page where everything is red says nothing, and a page where nothing is says less.
 */
export type Severity = "high" | "medium" | "low";

export type TeacherWarning = {
  /** Holds still while the same two numbers do. */
  key: string;
  teacherKey: string;
  kind: TeacherWarningKind;
  /** The few words the pill shows. */
  label: string;
  /** The whole sentence, for the title and the record. */
  sentence: string;
  /** How far apart the two figures are, in hours — what the list is ranked by. */
  apart: number;
  severity: Severity;
  dismissed?: boolean;
  dismissedBy?: string;
  dismissedAt?: string;
};

export type TeacherFigures = {
  /** How the warning names them, and what the key is built on. */
  teacherKey: string;
  teacher: string;
  /** Hours the department plans for them this semester. */
  planned: number;
  /** Hours the registrar has booked on the sections it staffs with them. */
  registrar: number;
  /** Hours their requisitions contract them for. Zero where they have none. */
  contracted: number;
  /** Hours actually taught to date: what met, less cancelled, plus stood in for. */
  taughtSoFar: number;
  /** A submitted timesheet, beside what actually met in the period it claims. */
  claims: { periodStart: string; periodLabel: string; claimed: number; taught: number }[];
};

/** Two hours, matching the check's own default — see backend/sorbonne/services/checks.py. */
export const DEFAULT_APART = 2;

function hours(value: number): string {
  return `${Math.round(value * 100) / 100} h`;
}

function gap(left: number, right: number): number {
  return Math.round(Math.abs(left - right) * 100) / 100;
}

/** Several times over the line is a different thing from just over it. */
function bySize(apart: number, threshold: number): Severity {
  const line = threshold > 0 && Number.isFinite(threshold) ? threshold : DEFAULT_APART;
  if (apart >= line * 5) return "high";
  if (apart >= line * 2) return "medium";
  return "low";
}

export function warningsFor(figures: TeacherFigures, apart: number = DEFAULT_APART): TeacherWarning[] {
  const found: TeacherWarning[] = [];
  const who = figures.teacherKey;
  const name = figures.teacher || "This teacher";

  // Ours against the registrar's. Both exist for anybody with sections, so this is the
  // one comparison that runs for a full-time teacher too.
  if (figures.planned > 0 && figures.registrar > 0 && gap(figures.planned, figures.registrar) >= apart) {
    const apartBy = gap(figures.planned, figures.registrar);
    found.push({
      key: `teacher-hours:plan-vs-registrar:${who}:${figures.planned}:${figures.registrar}`,
      teacherKey: who,
      kind: "plan_vs_registrar",
      severity: bySize(apartBy, apart),
      label: `Registrar ${figures.registrar < figures.planned ? "short" : "over"} ${hours(apartBy)}`,
      sentence: `${name}: we plan ${hours(figures.planned)} and the registrar has booked ${hours(figures.registrar)}.`,
      apart: apartBy,
    });
  }

  // Ours against their contract. Silent for anybody with no requisition, which is most of
  // the full-time staff.
  if (figures.contracted > 0 && figures.planned > 0 && gap(figures.planned, figures.contracted) >= apart) {
    const apartBy = gap(figures.planned, figures.contracted);
    found.push({
      key: `teacher-hours:plan-vs-contract:${who}:${figures.planned}:${figures.contracted}`,
      teacherKey: who,
      kind: "plan_vs_contract",
      severity: bySize(apartBy, apart),
      label: `Contract ${figures.contracted < figures.planned ? "short" : "over"} ${hours(apartBy)}`,
      sentence: `${name}: we plan ${hours(figures.planned)} and their requisitions contract ${hours(figures.contracted)}.`,
      apart: apartBy,
    });
  }

  // What they claimed against what met. One per period claimed, because a coordinator
  // answers a claim, not a teacher.
  for (const claim of figures.claims) {
    const apartBy = gap(claim.claimed, claim.taught);
    if (apartBy < apart) continue;
    found.push({
      key: `teacher-hours:claim-vs-taught:${who}:${claim.periodStart}:${claim.claimed}:${claim.taught}`,
      teacherKey: who,
      kind: "claim_vs_taught",
      severity: bySize(apartBy, apart),
      label: `Claim ${claim.claimed > claim.taught ? "over" : "under"} ${hours(apartBy)}`,
      sentence: `${name} claimed ${hours(claim.claimed)} for ${claim.periodLabel || claim.periodStart} and the timetable has ${hours(claim.taught)}.`,
      apart: apartBy,
    });
  }

  /*
   * Running out of contracted hours, said before they run out rather than after.
   *
   * The threshold is doing a different job here: it is how close to the end is close
   * enough to mention, not how far apart two numbers are. Over the contract it always
   * shows, whatever the threshold.
   */
  if (figures.contracted > 0 && figures.taughtSoFar > 0 && figures.taughtSoFar + apart >= figures.contracted) {
    const left = Math.round((figures.contracted - figures.taughtSoFar) * 100) / 100;
    found.push({
      key: `teacher-hours:contract-nearly-spent:${who}:${figures.contracted}:${figures.taughtSoFar}`,
      teacherKey: who,
      kind: "contract_nearly_spent",
      /*
       * The one place size does not say severity, and says the opposite of it: a small
       * number of hours left is the urgent case, and being past the contract is the one
       * somebody has to act on today.
       */
      severity: left < 0 ? "high" : left === 0 ? "medium" : "low",
      label: left < 0 ? `${hours(Math.abs(left))} past contract` : left === 0 ? "Contract used up" : `${hours(left)} of contract left`,
      sentence:
        left < 0
          ? `${name} has taught ${hours(figures.taughtSoFar)} against a contract of ${hours(figures.contracted)} — ${hours(Math.abs(left))} past it.`
          : `${name} has taught ${hours(figures.taughtSoFar)} of ${hours(figures.contracted)} contracted, with ${hours(left)} left.`,
      apart: Math.abs(left),
    });
  }

  return found.sort((left, right) => right.apart - left.apart);
}

/** How a row ranks: the biggest live gap on it, so sorting brings the worst to the top. */
export function warningRank(warnings: TeacherWarning[]): number {
  return warnings.filter((warning) => !warning.dismissed).reduce((worst, warning) => Math.max(worst, warning.apart), 0);
}
