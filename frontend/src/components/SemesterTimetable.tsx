import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { SelectMenu } from "@/components/SelectMenu";
import { buildCards, rowsPerPart, subRowLabel, teaches } from "@/services/courseCards";
import { fetchActiveCrns, fetchTermCrns, type ActiveCrn } from "@/services/portalLists";
import { fetchCourseCards } from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";

/*
 * The two zooms, as the range a slider runs over.
 *
 * Width is in SCREENS: at 1 the week is exactly as wide as the room it has, and every
 * notch above that is a wider week you scroll. Expressed in pixels per minute instead, the
 * bottom half of the slider did nothing on a wide monitor, because anything narrower than
 * the screen was drawn at screen width anyway. Height is one class's own height, which is
 * what decides how many of a busy day's classes you see without scrolling.
 */
const WIDTH = { min: 1, max: 6, step: 0.1, start: 1 };
const HEIGHT = { min: 14, max: 56, step: 1, start: 22 };

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
  const [cohorts, setCohorts] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [widthZoom, setWidthZoom] = useState(WIDTH.start);
  const [rowHeight, setRowHeight] = useState(HEIGHT.start);
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);
  // Where the week's arrows and dates go, so they cost no row of their own.
  const [navSlot, setNavSlot] = useState<HTMLDivElement | null>(null);
  // What the sweep could not draw. The grid hides the sentences that usually say so, and
  // silence about it would read as a complete week.
  const [missing, setMissing] = useState({ unasked: 0, gone: 0, unbooked: 0 });

  const held = useQuery({
    queryKey: ["term-crns", term.id],
    queryFn: () => fetchTermCrns(term.id),
    retry: false,
  });
  // The department's own list, so a box knows whether there is a record behind it to open.
  const register = useQuery({ queryKey: ["active-crns", ""], queryFn: () => fetchActiveCrns(), retry: false });
  const inRegister = (crn: string) => (register.data ?? []).find((row) => row.crn === crn) ?? null;

  /*
   * Which group of ours each section stands for — "TD 3", "CM 1 · Physics".
   *
   * Walked out of the cards rather than asked for, because a CRN is a cell of the matrix
   * and nothing indexes the matrix by it; the CRN record does the same walk for the same
   * reason. Worth the read: on a grid of the whole department the group is the second
   * thing you want after the course, ahead of the room and well ahead of the hour, which
   * the box's own position already tells you.
   */
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, retry: false });
  const { groupOf, cohortOf } = useMemo(() => {
    const groups = new Map<string, string>();
    const whose = new Map<string, string>();
    for (const card of buildCards(catalogues.data ?? [], () => "", [])) {
      for (const set of card.sets) {
        for (const row of set.rows.filter((entry) => teaches(entry)).flatMap((entry) => rowsPerPart(entry))) {
          const crn = row.section?.crn;
          if (!crn || groups.has(crn)) continue;
          groups.set(crn, `${set.scope.code} ${subRowLabel(row.group.label, row.major?.program ?? "", (row.group.majors ?? []).length)}`.trim());
          whose.set(crn, card.cohortName);
        }
      }
    }
    return { groupOf: groups, cohortOf: whose };
  }, [catalogues.data]);

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
        group: groupOf.get(crn) ?? "",
        // Not shown in the box — it is the filter's business, and the group already says
        // most of it — but carried so the filter has something to read.
        // One colour per COURSE, so a course's sections read as one thing across the week.
        colorKey: course.courseCode,
      }));
  }, [held.data, groupOf]);

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

  const cohortOptions = useMemo(
    () => [...new Set([...cohortOf.values()].filter(Boolean))].sort().map((value) => ({ value, label: value })),
    [cohortOf],
  );
  const shown = useMemo(
    () =>
      all.filter(
        (entry) =>
          (subjects.length === 0 || subjects.includes(subjectOf(entry.code))) &&
          (teachers.length === 0 || teachers.includes(entry.staff ?? "")) &&
          (cohorts.length === 0 || cohorts.includes(cohortOf.get(entry.crn) ?? "")),
      ),
    [all, subjects, teachers, cohorts, cohortOf],
  );
  const narrowed = subjects.length > 0 || teachers.length > 0 || cohorts.length > 0;

  return (
    /*
     * The page is exactly the screen and the grid scrolls inside it.
     *
     * The controls and the week's dates are what you steer by, so they stay put; a page
     * that scrolled as a whole took them off the top of the screen the moment you looked
     * at Friday.
     */
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Semesters
        </button>
        <h2 className="flex shrink-0 items-center gap-2 text-lg font-semibold text-[#171717]">
          <CalendarRange size={18} aria-hidden="true" /> {term.name}
        </h2>
        {/*
          * Everything you steer by on one row, pushed to the right.
          *
          * It was three rows — a title, the filters, the zooms — over a grid that wanted
          * every pixel of height it could get. Two of them were mostly white space.
          */}
        <div ref={setNavSlot} className="shrink-0" />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <div className="w-40">
                <SelectMenu
                  label="Cohorts"
                  value={cohorts.join("\n")}
                  multiple
                  itemNoun="cohort"
                  placeholder="Every cohort"
                  onChange={(next) => setCohorts(next ? next.split("\n").filter(Boolean) : [])}
                  options={cohortOptions}
                />
              </div>

              <div className="w-36">
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
              <div className="w-40">
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
              <Zoom label="Width" value={widthZoom} {...WIDTH} onChange={setWidthZoom} />
              <Zoom label="Height" value={rowHeight} {...HEIGHT} onChange={setRowHeight} />
              <span className="text-xs text-[#98a2b3]">
                {`${shown.length} of ${all.length}`}
                {missing.unasked + missing.gone + missing.unbooked ? (
                  <span
                    className="ml-2 text-[#8a6116]"
                    title={[
                      missing.unasked ? `${missing.unasked} never swept from the registrar — run a portal sync` : "",
                      missing.gone ? `${missing.gone} the registrar has stopped answering for` : "",
                      missing.unbooked ? `${missing.unbooked} the registrar has booked no hours for` : "",
                    ]
                      .filter(Boolean)
                      .join(". ")}
                  >
                    {missing.unasked + missing.gone + missing.unbooked} not drawn
                  </span>
                ) : null}
              </span>
              {narrowed ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubjects([]);
                    setTeachers([]);
                    setCohorts([]);
                  }}
                  className="text-xs font-semibold text-[#1f4e79] underline"
                >
                  Every section
                </button>
              ) : null}
        </div>
      </div>

      {held.isError ? (
        <p className="rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm text-[#8a6116]">
          This semester is not linked to a portal term, so the registrar has nothing to show for it.
        </p>
      ) : (
        <SectionTimetable
          fills
          entries={shown}
          daysDown
          onCoverage={setMissing}
          navInto={navSlot}
          widthZoom={widthZoom}
          rowHeight={rowHeight}
          title={term.name}
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

/** One axis of the zoom, as a slider: drag for size. */
function Zoom({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  start?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-[#d3d9e2] bg-white px-2 py-1.5">
      <span className="text-xs font-semibold text-[#667085]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} of a class`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-16 cursor-pointer accent-[#1f4e79]"
      />
    </label>
  );
}
