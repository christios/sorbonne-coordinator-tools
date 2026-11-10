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

import { fetchLastSweeps, fetchPortalFilters, fetchTermLinks, type ListKind } from "@/services/portalLists";
import type { SyncTarget } from "@/services/portalSync";
import { fetchViews } from "@/services/studentDatabase";
import { useRemembered } from "@/components/useRemembered";
import { SCHEMA_TERM } from "@/services/remembered";
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
  /**
   * Who synced that oldest list — the sync the age is about. Everybody reads the same
   * lists, so "57 min ago" on a coordinator's button may be somebody else's sync, and
   * without a name it read as one they had not run.
   */
  syncedBy: { email: string; name: string } | null;
  /**
   * Student lists not pulled for the semester chosen, because their own filter asks the
   * portal for another term — "All Sorbonne Students - S1" while Semester 2 is chosen.
   */
  leftOut: { name: string; terms: string[]; semester: string }[];
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
  const [links, terms, sweeps] = useQueries({
    queries: [
      { queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false },
      { queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false },
      // Only how old each sweep is, for the pop-up that chooses what to pull. Not waited for.
      { queryKey: ["facility-sweeps"], queryFn: fetchLastSweeps, retry: false },
    ],
  });
  /*
   * The semester the sync is about: the one chosen in the header, which every page is on.
   * Its courses, registrations and timetable are what the portal is asked for — the first
   * with a portal term until one is chosen.
   */
  const [chosenId] = useRemembered(SCHEMA_TERM);
  const linked = (terms.data ?? []).filter((term) => Boolean(links.data?.[term.id]));
  const picked = linked.find((term) => term.id === chosenId) ?? linked[0];
  const chosen = picked ? { code: links.data?.[picked.id] ?? "", name: picked.name } : null;

  // The students first: the cohorts, the rules and the registration check are all read
  // against them, so a run that did the others first would check yesterday's population.
  type Held = {
    id: string;
    name: string;
    filter: Record<string, string[]>;
    lastSyncedAt?: string;
    syncedTerms?: Record<string, string>;
  };
  const students = ((views.data ?? []) as Held[]).map((view) => ({ view, target: studentTarget(view, chosen) }));
  const targets: SyncTarget[] = [
    ...students.flatMap(({ target }) => (target ? [target] : [])),
    ...LISTS.flatMap((kind, index) =>
      ((lists[index]?.data ?? []) as Held[]).map((filter) => listTarget(kind, filter, chosen)),
    ),
  ];

  /*
   * The registrar's timetable last, and it has to be last.
   *
   * Which sections to ask about comes from the registrations we hold, so a sweep run
   * before them would ask about last week's list. It is also much the longest step — one
   * call per section, seconds apart, minutes rather than the minute the rest take — so
   * ending on it means everything else is already in by the time the waiting starts.
   *
   * The chosen semester's. A semester with no portal term cannot be asked about at all.
   */
  if (chosen?.code) {
    targets.push({
      kind: "timetable",
      id: chosen.code,
      name: `${chosen.name} timetable`,
      filter: {},
      lastSyncedAt: sweeps.data?.[chosen.code]?.at || undefined,
    });
  }

  type Synced = { lastSyncedAt?: string; lastSyncedBy?: string; lastSyncedByName?: string };
  const synced = [
    ...((views.data ?? []) as Synced[]),
    ...LISTS.flatMap((_, index) => (lists[index]?.data ?? []) as Synced[]),
  ];
  const ages = synced.map((row) => (row.lastSyncedAt ? Date.parse(row.lastSyncedAt) : Number.NaN));
  const oldest = ages.length && ages.every((at) => !Number.isNaN(at)) ? synced[ages.indexOf(Math.min(...ages))] : null;

  /*
   * Ready only once every question has its answer, failed or not.
   *
   * It used to be ready as soon as there was one thing to sync, which is the moment the
   * views landed — before the semesters had. A run resumed after a reload in that moment
   * had no timetable among its targets, and wrote the timetable step off as a list that
   * "no longer exists".
   */
  const settled = [views, ...lists, links, terms].every((query) => !query.isPending);

  return {
    targets,
    ready: settled && targets.length > 0,
    // A list nobody has ever synced makes the whole answer "never", not "as old as the
    // others" — there is no age to report when part of the picture has no age at all.
    syncedAt: ages.length && ages.every((at) => !Number.isNaN(at)) ? Math.min(...ages) : null,
    syncedBy: oldest?.lastSyncedBy ? { email: oldest.lastSyncedBy, name: oldest.lastSyncedByName || oldest.lastSyncedBy } : null,
    leftOut: students
      .filter(({ target }) => !target)
      .map(({ view }) => ({ name: view.name, terms: termsAskedBy(view.filter), semester: chosen?.name ?? "" })),
  };
}

/**
 * One portal filter as a list to pull. Courses and registrations are a term's: the filter is
 * pulled for the chosen semester's portal term and named after it. Teachers have no term, and
 * with no semester to ask about a list keeps to the extension's own term.
 */
export function listTarget(
  kind: "courses" | "teachers" | "registrations",
  filter: { id: string; name: string; filter: Record<string, string[]>; lastSyncedAt?: string; syncedTerms?: Record<string, string> },
  chosen: { code: string; name: string } | null,
): SyncTarget {
  if (kind === "teachers" || !chosen?.code) {
    return { kind, id: filter.id, name: filter.name, filter: filter.filter, lastSyncedAt: filter.lastSyncedAt || undefined };
  }
  return {
    kind,
    id: filter.id,
    name: `${filter.name} · ${chosen.name}`,
    filter: filter.filter,
    lastSyncedAt: filter.syncedTerms?.[chosen.code] || undefined,
    termCode: chosen.code,
  };
}

/**
 * A student list, pulled for the chosen semester's portal term — that semester's enrolment.
 *
 * It used to be left to the extension, whose own term is built in (262710), so in Semester 2
 * and every year after, Portal sync went on pulling the autumn's students. A browser keeps
 * one copy of each student list, so it is the enrolment of the semester last synced.
 */
export function studentTarget(
  view: { id: string; name: string; filter: Record<string, string[]>; lastSyncedAt?: string },
  chosen: { code: string; name: string } | null,
): SyncTarget | null {
  /*
   * A list whose own filter names its term is that term's enrolment, whatever is chosen:
   * the filter wins over the term asked for. "All Sorbonne Students - S1" pulled while
   * Semester 2 was chosen brought Semester 1's students back labelled Semester 2. It is
   * pulled with its own semester and left out of any other's run.
   */
  const fixed = termsAskedBy(view.filter);
  if (fixed.length && chosen?.code && !fixed.includes(chosen.code)) return null;
  const target: SyncTarget = {
    kind: "students",
    id: view.id,
    name: view.name,
    filter: view.filter,
    lastSyncedAt: view.lastSyncedAt || undefined,
  };
  return chosen?.code ? { ...target, name: `${view.name} · ${chosen.name}`, termCode: chosen.code } : target;
}

/** The portal terms a saved filter itself asks for, if it names any. */
export function termsAskedBy(filter: Record<string, string[]>): string[] {
  return (filter.TERM_CODE ?? []).map((code) => code.trim()).filter(Boolean);
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
    "facility-sweeps",
  ]) {
    client.invalidateQueries({ queryKey: [key] });
  }
}
