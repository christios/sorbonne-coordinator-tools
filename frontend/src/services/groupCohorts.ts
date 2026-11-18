/**
 * Whose a class is, by cohort: its set's cohort — or, for All cohorts' sets, the cohorts of
 * the students placed in its group.
 *
 * The languages sat on Foundation Year's row until 17 Nov 2026, so every page that named a
 * class's cohort by its set called A1-G1 FYS's, though it holds first, second and third
 * years too; asking for L1 hid the classes 113 first years sit in. All cohorts' sets belong
 * to no year, so the answer comes from who is in them: A1-G1 is FYS's, L1's, L2's and L3's.
 * A group nobody is placed in yet could be anybody's, so it is every cohort's.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Card } from "@/services/courseCards";
import { ALL_COHORTS, fetchAssignments, fetchCohorts } from "@/services/studentDatabase";

/** `group id -> the names of the cohorts with a student placed in it`. */
export type GroupCohorts = { placed: Map<string, Set<string>>; every: string[] };

export const NO_GROUP_COHORTS: GroupCohorts = { placed: new Map(), every: [] };

/** Every cohort's placements, read once and shared with the rest of the application. */
export function useGroupCohorts(enabled = true): GroupCohorts {
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts, enabled });
  const known = useMemo(() => cohorts.data ?? [], [cohorts.data]);
  const reads = useQueries({
    queries: known.map((cohort) => ({
      queryKey: ["assignments", cohort.id],
      queryFn: () => fetchAssignments(cohort.id),
      enabled,
      retry: false,
    })),
  });
  const stamp = reads.map((read) => read.dataUpdatedAt).join("|");
  return useMemo(() => {
    const placed = new Map<string, Set<string>>();
    known.forEach((cohort, index) => {
      for (const byScope of Object.values(reads[index]?.data ?? {})) {
        for (const groupId of Object.values(byScope)) {
          placed.set(groupId, (placed.get(groupId) ?? new Set()).add(cohort.name));
        }
      }
    });
    return { placed, every: known.map((cohort) => cohort.name) };
    // `reads` is a new array every render; `stamp` says when any of them changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, stamp]);
}

/** The cohorts a class of this card's group is for, by name. */
export function cohortsOfGroup(card: Pick<Card, "cohortId" | "cohortName">, groupId: string, groups: GroupCohorts): string[] {
  if (card.cohortId !== ALL_COHORTS) return [card.cohortName];
  const placed = [...(groups.placed.get(groupId) ?? [])].sort((left, right) => left.localeCompare(right));
  return placed.length ? placed : groups.every.length ? groups.every : [card.cohortName];
}
