import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import { CohortLoads } from "@/components/CohortLoads";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import type { TeacherRef } from "@/components/TeacherRecord";
import { useRemembered } from "@/components/useRemembered";
import { buildCards } from "@/services/courseCards";
import { fetchActiveCourses, fetchActiveTeachers, fetchTermLinks } from "@/services/portalLists";
import { SCHEMA_TERM } from "@/services/remembered";
import { useSemesterShown } from "@/services/semesterYears";
import { fetchCourseCards } from "@/services/studentDatabase";
import { academicYearOfTerm } from "@/services/teacherHoursRows";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * Teaching loads: the department's teaching-load workbook, drawn from the plan.
 *
 * The workbook was kept by hand, a tab per cohort — every course and its sections, who
 * teaches each and for how many hours, and under it how the cohort's hours split between
 * full-timers, part-timers, visiting professors and PhD students or postdocs, which is
 * what the Head of Department and the budget ask about. Here it is cohort by cohort over
 * the academic year of the semester chosen in the header, with the department added up.
 *
 * A page of its own under Groups & CRNs rather than a view of Teacher hours: that page is
 * one semester, teacher by teacher, and this is a year, course by course.
 */
export function TeachingLoads({
  onOpenTeacher,
  header,
}: {
  onOpenTeacher?: (teacher: TeacherRef) => void;
  /** The slot on the page's title line, top right, where the semester goes. */
  header?: HTMLElement | null;
}) {
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: () => fetchActiveCourses() });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: () => fetchActiveTeachers() });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const shownOf = useSemesterShown();
  // The semester every page is on, chosen in the header or in any page's own menu.
  const [termId, setTermId] = useRemembered(SCHEMA_TERM);

  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? "";
  const cards = useMemo(
    () => buildCards(catalogues.data ?? [], termName, courses.data ?? []),
    [catalogues.data, terms.data, courses.data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Every semester, in the portal's order, so the one chosen is shown even before it has sections.
  const termIds = useMemo(() => {
    const known = (terms.data ?? []).map((term) => term.id);
    const planned = [...new Set(cards.map((card) => card.termId).filter(Boolean))];
    return [...known, ...planned.filter((id) => !known.includes(id))];
  }, [cards, terms.data]);
  const chosenTerm = termIds.includes(termId) ? termId : (termIds[0] ?? "");
  const academicYear = academicYearOfTerm(links.data?.[chosenTerm] ?? "");
  // The semesters of the chosen one's year; the chosen one alone when it has no year.
  const yearTermIds = useMemo(
    () =>
      academicYear
        ? termIds.filter((id) => academicYearOfTerm(links.data?.[id] ?? "") === academicYear)
        : [chosenTerm].filter(Boolean),
    [academicYear, termIds, links.data, chosenTerm],
  );
  /*
   * Each semester as the page names it — "S1 · Semester 1" — in a function that stays the
   * same while the names do, so the page's search does not recount on every render.
   */
  const labelsKey = JSON.stringify(
    Object.fromEntries(
      termIds.map((id) => {
        const shown = shownOf({ id, name: termName(id) });
        return [id, shown.short ? `${shown.short} · ${shown.label}` : shown.label];
      }),
    ),
  );
  const labels = useMemo(() => JSON.parse(labelsKey) as Record<string, string>, [labelsKey]);
  const termLabel = useCallback((id: string) => labels[id] ?? "", [labels]);

  if (catalogues.isLoading || teachers.isLoading) return <ScreenLoading label="Adding up the year…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;

  const semesterMenu = (
    <SelectMenu
      label="Semester"
      value={chosenTerm}
      onChange={setTermId}
      options={termIds.map((id) => ({ value: id, ...shownOf({ id, name: termName(id) }) }))}
    />
  );
  return (
    <section>
      {header ? createPortal(<div className="w-fit min-w-[12rem] max-w-[min(24rem,100%)]">{semesterMenu}</div>, header) : null}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {header ? null : <LabelledPicker label="Semester">{semesterMenu}</LabelledPicker>}
        <p className="text-sm text-[#475467]">
          {academicYear ? `The academic year ${academicYear}, as planned` : `${termName(chosenTerm)}, as planned`}
        </p>
      </div>
      <CohortLoads
        cards={cards}
        termIds={yearTermIds}
        termLabel={termLabel}
        teachers={teachers.data ?? []}
        onOpenTeacher={onOpenTeacher}
      />
    </section>
  );
}
