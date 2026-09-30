import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import type { TimetableEntry } from "@/components/SectionTimetable";
import type { Card } from "@/services/courseCards";
import { teacherTimetable } from "@/services/personTimetable";
import { fetchFacilitySections, fetchTermLinks, type ActiveCrn, type ActiveTeacher, type FacilitySection, type FacilityTimetable } from "@/services/portalLists";
import { fetchSessionChanges, type SessionChange } from "@/services/sessionChanges";
import { availabilityOf, breakWeekOf, termBounds, windowProblem, type Availability, type FreeWindow } from "@/services/teacherAvailability";
import { sectionsTaughtBy } from "@/services/teacherLoad";
import { fetchTermWeeks, weekOneOf } from "@/services/termWeeks";

export type AvailabilityRead = {
  /** By the teacher's id on the department's list. Empty until everything has been read. */
  byId: Map<string, Availability>;
  loading: boolean;
  /** Something could not be read; the teachers it concerns are unknown rather than free. */
  failed: string;
  /** The Monday of the day's week, when the semester has no classes that week; "" otherwise. */
  breakWeek: string;
};

/** The registrar is asked about this many CRNs at a time, well inside what one request may name. */
const ASK_AT_ONCE = 200;

const NO_ANSWERS = new Map<string, Availability>();
const NO_WEEKS = new Map<string, TimetableEntry[]>();
const NOTHING: AvailabilityRead = { byId: NO_ANSWERS, loading: false, failed: "", breakWeek: "" };

/*
 * Outside the hook so their identity holds: an inline `combine` runs on every render and
 * hands back a new list each time, which would redo every teacher's answer with it.
 */
function combineNotes(reads: UseQueryResult<SessionChange[]>[]) {
  return { notes: reads.flatMap((read) => read.data ?? []), loading: reads.some((read) => read.isLoading) };
}

function combineSweeps(reads: UseQueryResult<FacilityTimetable>[]) {
  return {
    sweeps: reads.flatMap((read) => (read.data ? [read.data] : [])),
    loading: reads.some((read) => read.isLoading),
    failed: (reads.find((read) => read.error)?.error as Error | undefined)?.message ?? "",
  };
}

/**
 * Every active teacher's answer for one window — see services/teacherAvailability.
 *
 * What it needs is read once for the whole list, and only while a window is being asked
 * about: the registrar's sweep for every teacher's CRNs, the notes on the classes, and where
 * each semester starts. Their weeks are built as their records build them
 * (services/personTimetable), from the planning and the register the page has already
 * read — so `ready` says when those are in, because a week built before the planning
 * arrives is a week with nothing in it, and would read as free.
 */
export function useTeacherAvailability({
  window,
  teachers,
  cards,
  registered,
  ready,
}: {
  window: FreeWindow | null;
  teachers: ActiveTeacher[];
  cards: Card[];
  registered: ActiveCrn[];
  ready: boolean;
}): AvailabilityRead {
  const asking = Boolean(window && !windowProblem(window));
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: asking, retry: false });
  const weeks = useQuery({ queryKey: ["term-weeks"], queryFn: fetchTermWeeks, enabled: asking, retry: false });
  // Every linked term's notes: a cover can be in a semester somebody teaches nothing else in.
  const linkedTerms = useMemo(() => [...new Set(Object.values(links.data ?? {}).filter(Boolean))].sort(), [links.data]);
  const notes = useQueries({
    queries: linkedTerms.map((termCode) => ({
      queryKey: ["session-changes", termCode],
      queryFn: () => fetchSessionChanges(termCode),
      enabled: asking,
      retry: false,
    })),
    combine: combineNotes,
  });

  const weekOf = useMemo(
    () =>
      asking
        ? new Map(
            teachers.map((teacher) => [
              teacher.id,
              teacherTimetable({ cards, links: links.data ?? {}, registered, notes: notes.notes, teacher: { id: teacher.id, fullName: teacher.fullName } }),
            ]),
          )
        : NO_WEEKS,
    [asking, teachers, cards, links.data, registered, notes.notes],
  );
  const asked = useMemo(() => {
    const byTerm = new Map<string, Set<string>>();
    for (const entries of weekOf.values()) {
      for (const entry of entries) {
        if (!entry.termCode || !entry.crn) continue;
        byTerm.set(entry.termCode, (byTerm.get(entry.termCode) ?? new Set()).add(entry.crn));
      }
    }
    return [...byTerm.entries()].flatMap(([termCode, crns]) => {
      const sorted = [...crns].sort();
      return Array.from({ length: Math.ceil(sorted.length / ASK_AT_ONCE) }, (_, index) => ({
        termCode,
        crns: sorted.slice(index * ASK_AT_ONCE, (index + 1) * ASK_AT_ONCE),
      }));
    });
  }, [weekOf]);
  const swept = useQueries({
    queries: asked.map(({ termCode, crns }) => ({
      queryKey: ["facility-sections", termCode, crns.join(",")],
      queryFn: () => fetchFacilitySections(termCode, crns),
      // Once the notes are in, so the covers they add are asked about in the same breath.
      enabled: asking && ready && !links.isLoading && !notes.loading,
      retry: false,
    })),
    combine: combineSweeps,
  });

  const loading = asking && (!ready || links.isLoading || weeks.isLoading || notes.loading || swept.loading);
  const answered = useMemo(() => {
    if (!window || !asking || loading) return null;
    const sections = new Map<string, FacilitySection>();
    const byTerm = new Map<string, FacilitySection[]>();
    for (const sweep of swept.sweeps) {
      const held = byTerm.get(sweep.termCode) ?? [];
      for (const section of sweep.sections) {
        sections.set(`${sweep.termCode}|${section.crn}`, section);
        held.push(section);
      }
      byTerm.set(sweep.termCode, held);
    }
    const bounds = termBounds(
      [...new Set([...linkedTerms, ...byTerm.keys()])].map((termCode) => ({
        termCode,
        sections: byTerm.get(termCode) ?? [],
        weekOne: weekOneOf(termCode, links.data ?? {}, weeks.data ?? {})?.weekOne,
      })),
    );
    // Course-level rows that teach nobody, as the semester's week sets them aside.
    const parents = new Set(registered.filter((row) => row.childCount > 0 && row.usedBy === 0).map((row) => row.crn));
    const byId = new Map(
      teachers.map((teacher) => [
        teacher.id,
        availabilityOf({
          teacher: { id: teacher.id, fullName: teacher.fullName },
          entries: weekOf.get(teacher.id) ?? [],
          withoutCrn: sectionsTaughtBy(cards, teacher.id, teacher.fullName)
            .filter((section) => !section.retired && !section.crn)
            .map((section) => ({ termCode: links.data?.[section.termId] ?? "", code: section.courseCode })),
          sectionOf: (termCode, crn) => sections.get(`${termCode}|${crn}`),
          notes: notes.notes,
          bounds,
          notAClass: (crn) => parents.has(crn),
          window,
        }),
      ]),
    );
    return { byId, breakWeek: breakWeekOf(window, Object.values(weeks.data ?? {})) };
  }, [window, asking, loading, swept.sweeps, linkedTerms, links.data, weeks.data, registered, teachers, weekOf, cards, notes.notes]);

  if (!asking) return NOTHING;
  const failed = links.error
    ? "The semesters' portal terms could not be read."
    : swept.failed
      ? `The portal's timetable could not be read: ${swept.failed}`
      : "";
  return { byId: answered?.byId ?? NO_ANSWERS, loading, failed, breakWeek: answered?.breakWeek ?? "" };
}
