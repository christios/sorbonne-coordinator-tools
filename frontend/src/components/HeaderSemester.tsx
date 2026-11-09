import { PortalSemesterMenu, usePortalSemester } from "@/components/PortalSemesterMenu";

/**
 * The semester every page is on, chosen once in the header beside Portal sync.
 *
 * It is the same choice each page's own Semester menu shows — Cohorts, Groups & CRNs, the
 * Group schema, Courses and Teachers, Teacher hours, the Semester Timetable and the plan —
 * so moving it here moves them all, the page on screen included, and the Portal sync asks
 * the portal about this semester.
 */
export function HeaderSemester() {
  const { semesters, semester, setTermId } = usePortalSemester();
  if (semesters.length === 0) return null;
  return (
    <div className="hidden sm:block">
      <PortalSemesterMenu semesters={semesters} semester={semester} onChange={setTermId} />
    </div>
  );
}
