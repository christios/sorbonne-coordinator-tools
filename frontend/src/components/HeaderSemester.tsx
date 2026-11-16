import { useEffect } from "react";

import { PortalSemesterMenu, usePortalSemester } from "@/components/PortalSemesterMenu";

/**
 * The semester every page is on, chosen once in the header beside Portal sync — the only
 * place it is chosen. Cohorts, Groups & CRNs, the Group schema, Courses and Teachers,
 * Teacher hours, Capacity, the Semester Timetable and the plan all read it, so moving it
 * moves them all, the page on screen included, and Portal sync asks the portal about it.
 *
 * Each page used to carry a Semester menu of its own as well; with those gone, this one
 * shows on a phone too, narrower.
 */
export function HeaderSemester() {
  const { semesters, semester, setTermId, chosenId, settled } = usePortalSemester();
  /*
   * Nothing remembered yet, or a semester no longer offered: the menu shows the first one,
   * and the pages are told so. Some pages read the remembered choice alone and showed an
   * empty page until a semester was picked — on a menu that already looked picked.
   */
  useEffect(() => {
    if (settled && semester && chosenId !== semester.id) setTermId(semester.id);
  }, [settled, semester, chosenId, setTermId]);
  if (semesters.length === 0) return null;
  return <PortalSemesterMenu semesters={semesters} semester={semester} onChange={setTermId} compact />;
}
