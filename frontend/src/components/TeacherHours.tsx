import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { buildCards } from "@/services/courseCards";
import { rowText } from "@/services/copyCells";
import { fetchActiveCourses, fetchActiveCrns, fetchActiveTeachers } from "@/services/portalLists";
import { hoursColumn, requestSheets } from "@/services/timetableExport";
import { loadTotals, teacherLoads, type TeacherLoad } from "@/services/teacherLoad";
import { fetchCohorts, fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

const TYPES = ["CM", "TD", "TP"];

function Tile({ label, value, hint, alarm }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${alarm ? "border-[#e5b7b9] bg-[#fdf3f3]" : "border-[#d9dee7] bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alarm ? "text-[#a6292f]" : "text-[#171717]"}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[#98a2b3]">{hint}</p> : null}
    </div>
  );
}

/** A count of hours, or a hyphen: a nought printed everywhere makes a table of noughts. */
function Hours({ value, strong }: { value: number; strong?: boolean }) {
  if (!value) return <span className="text-[#d5dce4]">—</span>;
  return <span className={strong ? "font-semibold text-[#171717]" : "text-[#344054]"}>{value}</span>;
}

/**
 * What every teacher is carrying this semester.
 *
 * The same sheet the timetable workbook has carried for years — a row per teacher, a
 * column per cohort, then CM, TD and TP, then the total — computed from the same rows the
 * workbook is written from, so the two cannot disagree. It was only readable by building
 * the file and opening it; here it is on a page, while there is still time to move
 * something.
 *
 * The hours nobody is teaching are the last row rather than left out, because a section
 * with hours and no teacher is the one thing on this page worth acting on today.
 */
export function TeacherHours({ onOpenTeacher }: { onOpenTeacher?: (teacherId: string, name: string) => void }) {
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts });
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });
  const [termId, setTermId] = useState("");

  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
  const parentOf = useMemo(
    () => new Map((registered.data ?? []).filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn])),
    [registered.data],
  );
  const cards = useMemo(
    () => buildCards(catalogues.data ?? [], termName, courses.data ?? [], parentOf),
    [catalogues.data, terms.data, courses.data, parentOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const termIds = useMemo(() => [...new Set(cards.map((card) => card.termId).filter(Boolean))], [cards]);
  const chosenTerm = termIds.includes(termId) ? termId : (termIds[0] ?? "");

  const nameOf = (teacherId: string) => (teachers.data ?? []).find((teacher) => teacher.id === teacherId)?.fullName ?? "";
  const sheets = useMemo(
    () =>
      requestSheets(
        cards,
        chosenTerm,
        termName(chosenTerm),
        (cohortId) => {
          const cohort = (cohorts.data ?? []).find((candidate) => candidate.id === cohortId);
          return cohort?.majors.join(" / ") || cohort?.name || "";
        },
        nameOf,
        (cohortId) => (cohorts.data ?? []).find((candidate) => candidate.id === cohortId) ?? { name: "" },
      ),
    [cards, chosenTerm, cohorts.data, teachers.data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const loads = useMemo(() => teacherLoads(sheets), [sheets]);
  const totals = loadTotals(loads);
  const columns = sheets.map((sheet) => hoursColumn(sheet.title));

  const copy = () => {
    const lines = [rowText(["Teacher", ...columns, ...TYPES, "Total"])];
    for (const load of loads) {
      lines.push(
        rowText([
          load.teacher || "Nobody yet",
          ...load.bySheet.map(String),
          ...TYPES.map((type) => String(load.byType[type] ?? 0)),
          String(load.total),
        ]),
      );
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
  };

  if (catalogues.isLoading) return <ScreenLoading label="Adding up the hours…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;
  if (!termIds.length) {
    return (
      <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
        No sections yet. Groups &amp; CRNs is where they are made.
      </p>
    );
  }

  const cell = "px-3 py-2 text-right tabular-nums";

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <LabelledPicker label="Semester">
          <SelectMenu
            label="Semester"
            value={chosenTerm}
            onChange={setTermId}
            options={termIds.map((id) => ({ value: id, label: termName(id) }))}
          />
        </LabelledPicker>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Copy size={14} aria-hidden="true" /> Copy the numbers
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Teachers" value={String(totals.teachers)} hint="with hours this semester" />
        <Tile label="Hours in all" value={String(totals.hours)} hint={`across ${totals.sections} section${totals.sections === 1 ? "" : "s"}`} />
        <Tile
          label="Nobody yet"
          value={String(totals.unnamed)}
          hint={totals.unnamed ? "hours with no teacher named" : "every section has somebody"}
          alarm={totals.unnamed > 0}
        />
        <Tile label="Sheets" value={String(columns.length)} hint={columns.join(", ") || "none"} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">Teacher hours for {termName(chosenTerm)}</caption>
          <thead>
            <tr className="border-b border-[#e4e8ef] text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">
              <th scope="col" className="px-3 py-2 text-left">Teacher</th>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-3 py-2 text-right">{column}</th>
              ))}
              {TYPES.map((type) => (
                <th key={type} scope="col" className="px-3 py-2 text-right">{type}</th>
              ))}
              <th scope="col" className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((load) => (
              <Row
                key={load.teacherId || load.teacher || "nobody"}
                load={load}
                columns={columns}
                cell={cell}
                onOpen={load.teacherId && onOpenTeacher ? () => onOpenTeacher(load.teacherId, load.teacher) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        The same count the timetable workbook&apos;s Teacher Hours sheet carries, from the same rows — with the hours
        nobody is teaching shown, which the sheet leaves out. Hours a section does not state are its course&apos;s.
      </p>
    </section>
  );
}

function Row({
  load,
  columns,
  cell,
  onOpen,
}: {
  load: TeacherLoad;
  columns: string[];
  cell: string;
  onOpen?: () => void;
}) {
  const nobody = !load.teacher;
  return (
    <tr className={`border-b border-[#f2f4f7] last:border-0 ${nobody ? "bg-[#fdf9ee]" : "hover:bg-[#f8fafc]"}`}>
      <th scope="row" className="px-3 py-2 text-left font-medium">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="text-[#1f4e79] underline-offset-2 hover:underline">
            {load.teacher}
          </button>
        ) : (
          <span className={nobody ? "text-[#8a6116]" : "text-[#344054]"}>
            {load.teacher || "Nobody yet"}
            {!nobody && !load.teacherId ? (
              <span className="ml-2 text-[11px] font-normal text-[#98a2b3]">not confirmed</span>
            ) : null}
          </span>
        )}
        <span className="ml-2 text-[11px] font-normal tabular-nums text-[#98a2b3]">
          {load.sections} section{load.sections === 1 ? "" : "s"}
        </span>
      </th>
      {columns.map((column, index) => (
        <td key={column} className={cell}>
          <Hours value={load.bySheet[index] ?? 0} />
        </td>
      ))}
      {TYPES.map((type) => (
        <td key={type} className={cell}>
          <Hours value={load.byType[type] ?? 0} />
        </td>
      ))}
      <td className={`${cell} ${nobody ? "text-[#8a6116]" : ""}`}>
        <Hours value={load.total} strong />
      </td>
    </tr>
  );
}
