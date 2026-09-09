/**
 * Everything there is to sync — every student view and every portal filter of the three
 * lists, in the order the pages depend on each other in — and what to re-read once a
 * list has landed.
 *
 * Shared by the button that starts a run and the driver that picks an unfinished one up,
 * so the two can never disagree about what a run is made of. React Query answers both
 * from one fetch.
 */

import { useQueries, type QueryClient } from "@tanstack/react-query";

import { fetchPortalFilters, fetchTermLinks, type ListKind } from "@/services/portalLists";
import type { SyncTarget } from "@/services/portalSync";
import { fetchViews } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

const LISTS: ListKind[] = ["courses", "teachers", "registrations"];

export type SyncTargets = {
  targets: SyncTarget[];
  ready: boolean;
  /**
   * When the OLDEST list was last synced, or null when one has never been.
   *
   * Oldest, not most recent, and the distinction is the whole point: after a sync the
   * button's job is a staleness floor, and "just now" while a list is a week old is
   * exactly the lie it exists to prevent. `lastSyncedAt` was already being fetched here
   * and thrown away, so it costs no request.
   */
  syncedAt: number | null;
};

export function useSyncTargets(): SyncTargets {
  const [views, ...lists] = useQueries({
    queries: [
      { queryKey: ["views"], queryFn: fetchViews },
      ...LISTS.map((kind) => ({ queryKey: ["portal-filters", kind], queryFn: () => fetchPortalFilters(kind) })),
    ],
  });
  /*
   * Which semesters have a portal term to ask about, and what they are called.
   *
   * `retry: false` on both, and a run goes ahead without them: the timetable is the one
   * step whose absence costs the others nothing, and a Student Hub that is down must not
   * stop a coordinator syncing their students.
   */
  const [links, terms] = useQueries({
    queries: [
      { queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false },
      { queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false },
    ],
  });

  // The students first: the cohorts, the rules and the registration check are all read
  // against them, so a run that did the others first would check yesterday's population.
  const targets: SyncTarget[] = [
    ...((views.data ?? []) as { id: string; name: string; filter: Record<string, string[]> }[]).map((view) => ({
      kind: "students" as const,
      id: view.id,
      name: view.name,
      filter: view.filter,
    })),
    ...LISTS.flatMap((kind, index) =>
      ((lists[index]?.data ?? []) as { id: string; name: string; filter: Record<string, string[]> }[]).map((filter) => ({
        kind,
        id: filter.id,
        name: filter.name,
        filter: filter.filter,
      })),
    ),
  ];

  /*
   * The registrar's timetable last, and it has to be last.
   *
   * Which sections to ask about comes from the registrations we hold, so a sweep run
   * before them would ask about last week's list. It is also much the longest step — one
   * call per section, two at a time, minutes rather than the minute the rest take — so
   * ending on it means everything else is already in by the time the waiting starts.
   *
   * One per linked semester. A semester with no portal term cannot be asked about at all.
   */
  for (const [termId, portalTermCode] of Object.entries(links.data ?? {})) {
    if (!portalTermCode) continue;
    const named = (terms.data ?? []).find((term) => term.id === termId)?.name;
    targets.push({
      kind: "timetable",
      id: portalTermCode,
      name: named ? `${named} timetable` : `Timetable ${portalTermCode}`,
      filter: {},
    });
  }

  const ages = [
    ...((views.data ?? []) as { lastSyncedAt?: string }[]),
    ...LISTS.flatMap((_, index) => (lists[index]?.data ?? []) as { lastSyncedAt?: string }[]),
  ].map((row) => (row.lastSyncedAt ? Date.parse(row.lastSyncedAt) : Number.NaN));

  return {
    targets,
    ready: targets.length > 0,
    // A list nobody has ever synced makes the whole answer "never", not "as old as the
    // others" — there is no age to report when part of the picture has no age at all.
    syncedAt: ages.length && ages.every((at) => !Number.isNaN(at)) ? Math.min(...ages) : null,
  };
}

/** What the pages read from the server, so every one of them is right again. */
export function freshen(client: QueryClient): void {
  for (const key of [
    "views",
    "portal-filters",
    "students",
    "cohorts",
    "portal",
    "registration-check",
    "active-teachers",
    "active-courses",
    "course-cards",
    // What a timetable sweep changes: the clash counts, the coverage lines, and the
    // date-aware expectation that is inert until one has landed.
    "term-clashes",
    "facility-coverage",
  ]) {
    client.invalidateQueries({ queryKey: [key] });
  }
}
