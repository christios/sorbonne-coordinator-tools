import { shortTerm } from "@/services/rosterView";
import type { Catalogue } from "@/services/studentDatabase";

/** What a group holds, from the cohort-blind course-cards read. */
export type GroupCrns = Record<string, string[]>;

/** The registrar's answer: `crn -> ["Mon","Tue"]`, plus the sections nobody asked about. */
export type SectionDays = { days: Record<string, string[]>; blind: string[] };

/** The token a group with no known hours contributes, so its absence is never a silence. */
export const DAY_UNKNOWN = "day unknown";

/**
 * "LANG Tue" — one token per set and weekday a student is actually in.
 *
 * A **correlated** value, and that is the whole point. Two flat columns cannot answer
 * "languages on a Tuesday": `applyFilters` runs each filter against its own column, so
 * `sets include LANG` AND `meetsOn include Tue` matches a student who takes languages and
 * separately has maths on Tuesday. A flat day column is worse than no column at all — it
 * reads like a correlated question and quietly answers a different one.
 *
 * One `multiOption` column of `set × day` tokens answers it with no change to the filter
 * engine, and "include all of" then composes two correlated clauses for free.
 *
 * **Blindness is a token, not a silence.** A group whose CRN has no facility row yields
 * `"LANG day unknown"`. Without it, `Meets exclude LANG Tue` would quietly select the
 * students whose language hour nobody has asked about — a false negative over incomplete
 * evidence, which is the failure this whole record exists to stop.
 *
 * The semester prefix follows `groupLabels`' rule exactly rather than a second one: it
 * appears only when the student has groups in more than one semester, and only when the
 * semester has a name to show.
 */
export function meetsTokens(
  placements: { termId: string; scopeCode: string; groupId: string }[],
  crnsOf: GroupCrns,
  days: Record<string, string[]>,
  termNames: Record<string, string> = {},
): string[] {
  const terms = new Set(placements.map((placement) => placement.termId));
  const tokens = new Set<string>();
  for (const placement of placements) {
    const term = termNames[placement.termId];
    const prefix = terms.size > 1 && term ? `${shortTerm(term)} · ` : "";
    const crns = crnsOf[placement.groupId] ?? [];
    // A group with no sections yet is not a group that meets on no days.
    const known = crns.flatMap((crn) => days[crn] ?? []);
    const said = known.length ? [...new Set(known)] : [DAY_UNKNOWN];
    for (const day of said) tokens.add(`${prefix}${placement.scopeCode} ${day}`);
  }
  return [...tokens].sort();
}

/** The distinct sets a student is in — "for languages" in one tick, and not correlated. */
export function setTokens(
  placements: { termId: string; scopeCode: string }[],
  termNames: Record<string, string> = {},
): string[] {
  const terms = new Set(placements.map((placement) => placement.termId));
  const tokens = new Set<string>();
  for (const placement of placements) {
    const term = termNames[placement.termId];
    const prefix = terms.size > 1 && term ? `${shortTerm(term)} · ` : "";
    tokens.add(`${prefix}${placement.scopeCode}`);
  }
  return [...tokens].sort();
}

/**
 * `groupId -> [crn]`, from the cohort-blind course-cards read.
 *
 * Cohort-blind on purpose: a set open to every cohort is filed under whichever cohort
 * holds its row, so reading the catalogue cohort by cohort loses the language groups for
 * everybody else — the exact class of thing this column exists to make visible.
 */
export function groupCrns(catalogues: Catalogue[]): GroupCrns {
  const held: GroupCrns = {};
  for (const catalogue of catalogues) {
    for (const scope of catalogue.scopes ?? []) {
      for (const group of scope.groups ?? []) {
        const crns = Object.values(group.crns ?? {})
          .filter((section) => section.crn && !section.retired)
          .map((section) => section.crn);
        if (crns.length) held[group.id] = [...new Set([...(held[group.id] ?? []), ...crns])];
      }
    }
  }
  return held;
}
