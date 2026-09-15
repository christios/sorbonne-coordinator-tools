import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { SelectMenu } from "@/components/SelectMenu";
import { fetchTermCrns } from "@/services/portalLists";
import type { TimetableTerm } from "@/services/timetables";

/**
 * A whole semester's week in one grid: every section the registrar has booked, at once.
 *
 * The other calendars in this application answer "when is this ONE thing taught" — a
 * student's week, a teacher's, a CRN's. None of them answers the question a coordinator
 * asks while moving a class: what else is in that hour. That question is about the whole
 * department at once, so this draws the whole department at once.
 *
 * It is dense on purpose, and the department's real week is denser than it looks: at the
 * worst hour of Semester 1 sixteen sections share one weekday and start time, so sixteen
 * boxes share one column. That is legible enough to see the SHAPE of the hour and not
 * enough to read a room number off, which is why the filters below are part of the
 * feature rather than a refinement of it. Narrow to a subject or a teacher and the same
 * grid becomes readable; widen again to see what you would collide with.
 *
 * The sections come from the registrar's own sweep, like every other calendar here, so a
 * semester nobody has swept shows nothing rather than showing our planning as though it
 * were booked.
 */
export function SemesterTimetable({ term, open, onClose }: { term: TimetableTerm; open: boolean; onClose: () => void }) {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);

  const held = useQuery({
    queryKey: ["term-crns", term.id],
    queryFn: () => fetchTermCrns(term.id),
    enabled: open,
    retry: false,
  });

  const all = useMemo<TimetableEntry[]>(() => {
    const crns = held.data?.crns ?? {};
    const termCode = held.data?.portalTermCode ?? "";
    return Object.entries(crns)
      .filter(([, course]) => course.status === "in_portal")
      .map(([crn, course]) => ({
        termCode,
        crn,
        code: course.courseCode,
        title: course.title,
        staff: course.teacherName,
        // One colour per COURSE, so the sections of a course read as one thing across the
        // week — which is how somebody looking for a clash scans it.
        colorKey: course.courseCode,
      }));
  }, [held.data]);

  /** The subject is the code's first segment: MATH-222 and MATH-351 are one subject. */
  const subjectOf = (code: string) => (code.split("-", 1)[0] || code).toUpperCase();

  const subjectOptions = useMemo(
    () => [...new Set(all.map((entry) => subjectOf(entry.code)).filter(Boolean))].sort().map((value) => ({ value, label: value })),
    [all],
  );
  const teacherOptions = useMemo(
    () => [...new Set(all.map((entry) => entry.staff ?? "").filter(Boolean))].sort().map((value) => ({ value, label: value })),
    [all],
  );

  const shown = useMemo(
    () =>
      all.filter(
        (entry) =>
          (subjects.length === 0 || subjects.includes(subjectOf(entry.code))) &&
          (teachers.length === 0 || teachers.includes(entry.staff ?? "")),
      ),
    [all, subjects, teachers],
  );

  const narrowed = subjects.length > 0 || teachers.length > 0;

  return (
    <Modal
      open={open}
      size="wide"
      title={`${term.name} — the whole week`}
      description="Every section the registrar has booked this semester, in one grid. Narrow it to read an hour; widen it to see what an hour already holds."
      onClose={onClose}
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <SelectMenu
            label="Subjects"
            value={subjects.join("\n")}
            multiple
            itemNoun="subject"
            placeholder="Every subject"
            searchable={subjectOptions.length > 12}
            onChange={(next) => setSubjects(next ? next.split("\n").filter(Boolean) : [])}
            options={subjectOptions}
          />
        </div>
        <div className="w-64">
          <SelectMenu
            label="Teachers"
            value={teachers.join("\n")}
            multiple
            itemNoun="teacher"
            placeholder="Every teacher"
            searchable={teacherOptions.length > 12}
            onChange={(next) => setTeachers(next ? next.split("\n").filter(Boolean) : [])}
            options={teacherOptions}
          />
        </div>
        <p className="text-xs text-[#98a2b3]">
          {held.isPending
            ? "Reading the semester…"
            : `${shown.length} of ${all.length} section${all.length === 1 ? "" : "s"}${narrowed ? " shown" : ""}`}
        </p>
        {narrowed ? (
          <button
            type="button"
            onClick={() => {
              setSubjects([]);
              setTeachers([]);
            }}
            className="text-xs font-semibold text-[#1f4e79] underline"
          >
            Show every section
          </button>
        ) : null}
      </div>

      {held.isError ? (
        <p className="rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm text-[#8a6116]">
          This semester is not linked to a portal term, so the registrar has nothing to show for it.
        </p>
      ) : (
        <SectionTimetable
          entries={shown}
          title={`${term.name} — the whole week`}
          emptyMessage={
            all.length
              ? "Nothing matches those filters."
              : "No section of this semester has been swept from the registrar's timetable yet."
          }
        />
      )}
    </Modal>
  );
}

/** The button that opens it, for a semester's row. */
export function SemesterTimetableButton({ term }: { term: TimetableTerm }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`See every section of ${term.name} in one week`}
        className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange size={15} aria-hidden="true" />
          Timetable
        </span>
      </button>
      <SemesterTimetable term={term} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
