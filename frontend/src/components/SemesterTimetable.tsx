import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarRange, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { SelectMenu } from "@/components/SelectMenu";
import { fetchActiveCrns, fetchTermCrns, type ActiveCrn } from "@/services/portalLists";
import type { TimetableTerm } from "@/services/timetables";

/** How tall an hour is, and how wide a day is, at each notch of the zoom. */
const HOUR_HEIGHTS = [48, 72, 110, 170, 260, 400, 600];
const DAY_WIDTHS = [88, 130, 190, 280, 420, 640];

/**
 * A whole semester's week, as a page rather than a card.
 *
 * Every other calendar here answers "when is this ONE thing taught" — a student's week, a
 * teacher's, a CRN's — and fits in a card beside other cards. None of them answers the
 * question a coordinator asks while moving a class: what else is in that hour. That
 * question is about the whole department at once, and the whole department does not fit in
 * a card, so this takes the page.
 *
 * Three things follow from the scale, and each was a correction to a first version that
 * treated this like the small calendars:
 *
 * - **Stacked, not side by side.** Sixteen sections share the worst hour of a real
 *   semester. Side by side that is sixteen coloured slivers; stacked, each keeps the full
 *   width of its day and gives up height, which the zoom gives back.
 * - **Zoom on both axes.** With stacking, height is the currency — an hour has to be able
 *   to grow until its classes are readable, and the week scrolls rather than shrinking to
 *   fit.
 * - **The boxes open.** A class on any other calendar here opens its CRN; there is no
 *   reason this one should be the exception, and it is the calendar you are most likely to
 *   be looking at when you want to know what a section actually is.
 */
export function SemesterTimetable({ term, onBack }: { term: TimetableTerm; onBack: () => void }) {
  const client = useQueryClient();
  const [subjects, setSubjects] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [hourNotch, setHourNotch] = useState(2);
  const [dayNotch, setDayNotch] = useState(1);
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);

  const held = useQuery({
    queryKey: ["term-crns", term.id],
    queryFn: () => fetchTermCrns(term.id),
    retry: false,
  });
  // The department's own list, so a box knows whether there is a record behind it to open.
  const register = useQuery({ queryKey: ["active-crns", ""], queryFn: () => fetchActiveCrns(), retry: false });
  const inRegister = (crn: string) => (register.data ?? []).find((row) => row.crn === crn) ?? null;

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
        // One colour per COURSE, so a course's sections read as one thing across the week.
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
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Semesters
        </button>
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-[#171717]">
            <CalendarRange size={18} aria-hidden="true" /> {term.name} — the whole week
          </h2>
          <p className="text-sm text-[#667085]">
            Every section the registrar has booked this semester. Press a class to open its CRN.
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-52">
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
        <div className="w-60">
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
        <Zoom label="Hour" notch={hourNotch} notches={HOUR_HEIGHTS.length} onChange={setHourNotch} />
        <Zoom label="Day" notch={dayNotch} notches={DAY_WIDTHS.length} onChange={setDayNotch} />
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
          stack
          hourHeight={HOUR_HEIGHTS[hourNotch]}
          dayWidth={DAY_WIDTHS[dayNotch]}
          title={`${term.name} — the whole week`}
          openable={(crn) => Boolean(inRegister(crn))}
          onOpenCrn={(crn) => setShowingCrn(inRegister(crn))}
          emptyMessage={
            all.length
              ? "Nothing matches those filters."
              : "No section of this semester has been swept from the registrar's timetable yet."
          }
        />
      )}

      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(register.data ?? []).filter(
            (entry) => entry.courseCode === showingCrn.courseCode && entry.termCode === showingCrn.termCode,
          )}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void client.invalidateQueries({ queryKey: ["active-crns"] })}
        />
      ) : null}
    </section>
  );
}

/** One axis of the zoom: a notch up, a notch down, and how far along it is. */
function Zoom({
  label,
  notch,
  notches,
  onChange,
}: {
  label: string;
  notch: number;
  notches: number;
  onChange: (notch: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-[#d3d9e2] bg-white p-1">
      <span className="px-1 text-xs font-semibold text-[#667085]">{label}</span>
      <button
        type="button"
        aria-label={`Less ${label.toLowerCase()}`}
        disabled={notch === 0}
        onClick={() => onChange(Math.max(0, notch - 1))}
        className="rounded p-1 text-[#344054] hover:bg-[#f2f4f7] disabled:text-[#c8d0da]"
      >
        <Minus size={13} aria-hidden="true" />
      </button>
      <span className="w-8 text-center text-xs tabular-nums text-[#98a2b3]">
        {notch + 1}/{notches}
      </span>
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={notch === notches - 1}
        onClick={() => onChange(Math.min(notches - 1, notch + 1))}
        className="rounded p-1 text-[#344054] hover:bg-[#f2f4f7] disabled:text-[#c8d0da]"
      >
        <Plus size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
