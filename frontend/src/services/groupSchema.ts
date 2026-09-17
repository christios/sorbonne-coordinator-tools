/**
 * The shape of a semester, read for the page that edits it.
 *
 * A group set is the durable object here: it says how one cohort is split for one
 * semester, which courses it carries, and what groups sit inside it. Groups & CRNs then
 * fills those groups with CRNs and teachers, and Capacity counts who is in them. So the
 * questions this page has to answer are structural — is anything left dangling, does a
 * set do nothing, is a group somewhere nobody can reach — and none of them are about a
 * CRN.
 *
 * Pure: it is handed the catalogue and gives back readings of it.
 */

import { sameProgram } from "@/services/programmes";
import type { CatalogueScope } from "@/services/studentDatabase";

/** A set as the list shows it: what it holds, and whether anything is wrong with it. */
export type SetReading = {
  scope: CatalogueScope;
  groups: number;
  courses: number;
  placed: number;
  /** The set is the department's, not this cohort's — the languages. */
  shared: boolean;
  /** Whose row it is, when that is not the cohort being looked at. */
  ownedElsewhere: boolean;
  trouble: SetTrouble[];
};

export type SetTrouble = "no course" | "no group" | "no parent set" | "groups adrift" | "sub-row nobody is on";

export type SchemaTotals = { sets: number; groups: number; courses: number; placed: number };

/**
 * What is wrong with one set.
 *
 * A nested set naming no parent, and a nested group naming no group of that parent, are
 * the two that actually break something: the fill planner cannot place anybody into them.
 * A set with no course or no group is merely useless, which is worth saying more quietly.
 */
/**
 * The sub-rows of a set naming a programme none of these students is on.
 *
 * A sub-row is what makes a group open to one programme and shut to the others, so one
 * that matches nobody shuts the group to everybody — silently, since a group nobody may
 * enter looks exactly like a group nobody has been put in yet.
 *
 * `known` is what the browser has pulled, and an empty one judges nothing: a browser that
 * has not synced knows of no programmes at all, and would otherwise call every sub-row in
 * the department wrong.
 */
export function subRowsNobodyIsOn(
  scope: CatalogueScope,
  known: readonly string[],
): { group: string; program: string }[] {
  if (!known.length) return [];
  const orphans: { group: string; program: string }[] = [];
  for (const group of scope.groups) {
    for (const major of group.majors ?? []) {
      if (!major.program.trim()) continue;
      if (!known.some((program) => sameProgram(program, major.program))) {
        orphans.push({ group: group.label, program: major.program });
      }
    }
  }
  return orphans;
}

/**
 * The codes a cohort expects that none of these students is on.
 *
 * A cohort's majors are what "their major is not this cohort's" is measured against, so a
 * code nobody is on is a rule that quietly passes everybody rather than a rule that
 * catches nobody — the two look identical from the outside, and only one of them is right.
 */
export function unknownMajors(expected: readonly string[], known: readonly string[]): string[] {
  if (!known.length) return [];
  return expected.filter((code) => code.trim() && !known.some((program) => sameProgram(program, code)));
}

export function troubleWith(
  scope: CatalogueScope,
  byId: Map<string, CatalogueScope>,
  known: readonly string[] = [],
): SetTrouble[] {
  const trouble: SetTrouble[] = [];
  if (scope.kind === "nested") {
    const parent = scope.parentScopeId ? byId.get(scope.parentScopeId) : undefined;
    if (!parent) trouble.push("no parent set");
    else {
      const seats = new Set(parent.groups.map((group) => group.id));
      if (scope.groups.some((group) => !group.parentGroupId || !seats.has(group.parentGroupId))) {
        trouble.push("groups adrift");
      }
    }
  }
  if (!scope.courses.length) trouble.push("no course");
  if (!scope.groups.length) trouble.push("no group");
  if (subRowsNobodyIsOn(scope, known).length) trouble.push("sub-row nobody is on");
  return trouble;
}

export function readSets(
  scopes: CatalogueScope[],
  cohortId: string,
  known: readonly string[] = [],
): SetReading[] {
  const byId = new Map(scopes.map((scope) => [scope.id, scope]));
  return scopes
    .map((scope) => ({
      scope,
      groups: scope.groups.length,
      courses: scope.courses.length,
      placed: scope.groups.reduce((total, group) => total + group.assigned, 0),
      shared: scope.openToAll,
      ownedElsewhere: Boolean(scope.cohortId) && scope.cohortId !== cohortId,
      trouble: troubleWith(scope, byId, known),
    }))
    // This cohort's own first, the department's after: they are a different kind of thing.
    .sort((left, right) => Number(left.shared) - Number(right.shared));
}

export function totalsOf(readings: SetReading[]): SchemaTotals {
  return {
    sets: readings.length,
    groups: readings.reduce((total, reading) => total + reading.groups, 0),
    courses: readings.reduce((total, reading) => total + reading.courses, 0),
    placed: readings.reduce((total, reading) => total + reading.placed, 0),
  };
}

/**
 * The labels "TD 1–6" stands for.
 *
 * Making six groups one at a time is six dialogs to say the same thing six times, and the
 * seventh is the one that gets called "6 " by accident. A range says it once. Anything
 * that is not a range is taken literally, so "A1-G1" is still one group called A1-G1.
 */
export function labelsFrom(text: string): string[] {
  const range = text.trim().match(/^(.*?)(\d+)\s*(?:–|—|-|\.\.|to)\s*(\d+)$/);
  if (!range) return text.trim() ? [text.trim()] : [];
  const [, stem, from, to] = range;
  const first = Number(from);
  const last = Number(to);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first > 60) {
    return [text.trim()];
  }
  // The stem keeps its own spacing: "TD 1-6" is TD 1 … TD 6, and "G.2 to 4" is G.2 … G.4.
  const head = stem.replace(/^\s+/, "");
  const labels: string[] = [];
  for (let at = first; at <= last; at += 1) labels.push(`${head}${at}`);
  return labels;
}
