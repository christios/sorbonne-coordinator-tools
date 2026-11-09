import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { SelectMenu } from "@/components/SelectMenu";
import { useRemembered } from "@/components/useRemembered";
import { fetchTermLinks } from "@/services/portalLists";
import { SCHEMA_TERM } from "@/services/remembered";
import { useSemesterShown } from "@/services/semesterYears";
import { fetchTimetableTerms, type TimetableTerm } from "@/services/timetables";

/**
 * The semester a Portal validation page is about: Courses, Active CRNs, Teachers, Active
 * teachers.
 *
 * Those pages speak the portal's language, so a semester here is one with a portal term —
 * 262710, 262720 — and what the page asks for is that term. The semester chosen is the one
 * every other page shows (Cohorts, Groups & CRNs, Group schema), so moving between them keeps
 * to the same semester. With none chosen yet, the first in the portal's order.
 */
export function usePortalSemester() {
  const [termId, setTermId] = useRemembered(SCHEMA_TERM);
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const semesters = useMemo(
    () => (terms.data ?? []).filter((term) => Boolean(links.data?.[term.id])),
    [terms.data, links.data],
  );
  const semester = semesters.find((term) => term.id === termId) ?? semesters[0] ?? null;
  return {
    semesters,
    semester,
    setTermId,
    /** The semester's portal term, "" until it is known. */
    term: semester ? (links.data?.[semester.id] ?? "") : "",
    settled: !terms.isLoading && !links.isLoading,
  };
}

/**
 * The menu itself, saying each semester as every semester menu does: tag, year, name.
 *
 * On the page's title line, top right, as on Cohorts, when the page is given that slot;
 * where it is rendered otherwise.
 */
export function PortalSemesterMenu({
  semesters,
  semester,
  onChange,
  header,
  children,
}: {
  semesters: TimetableTerm[];
  semester: TimetableTerm | null;
  onChange: (termId: string) => void;
  header?: HTMLElement | null;
  /** Beside the menu, to its right: the semester's own settings, where a page has some. */
  children?: ReactNode;
}) {
  const shownOf = useSemesterShown();
  const menu = (
    <div className="flex items-center gap-2">
      <div className="w-fit min-w-[12rem] max-w-[min(24rem,100%)]">
        <SelectMenu
          label="Semester"
          value={semester?.id ?? ""}
          onChange={onChange}
          placeholder="No semester yet"
          options={semesters.map((term) => ({ value: term.id, ...shownOf(term) }))}
        />
      </div>
      {children}
    </div>
  );
  return header ? createPortal(menu, header) : menu;
}
