import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { LabelledPicker } from "@/components/LabelledPicker";
import { ListGrid, StatePill } from "@/components/ListGrid";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import type { TeacherRef } from "@/components/TeacherRecord";
import { buildCards } from "@/services/courseCards";
import { fetchActiveCourses, fetchActiveCrns, fetchActiveTeachers, fetchFacilityHours, fetchTermLinks } from "@/services/portalLists";
import { adjustmentsFor, fetchSessionChanges } from "@/services/sessionChanges";
import { requestSheets } from "@/services/timetableExport";
import {
  crnsByTeacher,
  hoursColumn,
  hoursColumns,
  loadRows,
  loadTotals,
  registrarHoursFor,
  sameTeacher,
  shownHoursColumns,
  teacherLoads,
  type LoadRow,
} from "@/services/teacherLoad";
import type { GridColumn } from "@/services/studentColumns";
import { fetchCohorts, fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

function Tile({ label, value, hint, alarm }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${alarm ? "border-[#e5b7b9] bg-[#fdf3f3]" : "border-[#d9dee7] bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alarm ? "text-[#a6292f]" : "text-[#171717]"}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[#98a2b3]">{hint}</p> : null}
    </div>
  );
}

/**
 * What every teacher is carrying this semester.
 *
 * The same count the timetable workbook's Teacher Hours sheet has carried for years — a row
 * per teacher, a column per cohort, then CM, TD and TP, then the total — computed from the
 * rows the workbook is written from, so the sheet and the screen cannot come apart. It was
 * only readable by building the file and opening it; here it is while there is still time
 * to move something.
 *
 * On the same table as the students, so it sorts, filters and copies the way every other
 * list here does — which is most of the point. "Which part-time teachers are over forty
 * hours" is two chips on this table and an afternoon in the workbook.
 *
 * The hours nobody is teaching are a row rather than an omission. The sheet leaves them
 * out, which is fair for a file the timetabler receives; on a page they are the thing
 * worth finding, because a section with hours and no teacher is a class with nobody in
 * front of it.
 */
export function TeacherHours({ onOpenTeacher }: { onOpenTeacher?: (teacher: TeacherRef) => void }) {
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
        (teacherId) => (teachers.data ?? []).find((teacher) => teacher.id === teacherId)?.fullName ?? "",
        (cohortId) => (cohorts.data ?? []).find((candidate) => candidate.id === cohortId) ?? { name: "" },
      ),
    [cards, chosenTerm, cohorts.data, teachers.data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // The notes on the term's classes — cancelled, covered — read against each teacher's CRNs.
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const termCode = links.data?.[chosenTerm] ?? "";
  const notes = useQuery({
    queryKey: ["session-changes", termCode],
    queryFn: () => fetchSessionChanges(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  // The registrar's booked hours per section, for the column beside ours.
  const booked = useQuery({
    queryKey: ["facility-hours", termCode],
    queryFn: () => fetchFacilityHours(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const rows = useMemo(() => {
    const held = loadRows(teacherLoads(sheets), teachers.data ?? [], crnsByTeacher(sheets));
    return held.map((row) => {
      const adjusted = adjustmentsFor(notes.data ?? [], { id: row.active?.id ?? row.teacherId, name: row.teacher }, new Set(row.crns), sameTeacher);
      return {
        ...row,
        cancelledHours: adjusted.cancelled,
        coverTaken: adjusted.coveredByOthers,
        coverGiven: adjusted.coveredForOthers,
        registrarHours: registrarHoursFor(booked.data ?? {}, row.teacher, sameTeacher),
      };
    });
  }, [sheets, teachers.data, notes.data, booked.data]);
  const registrarTotal = Math.round(rows.reduce((sum, row) => sum + row.registrarHours, 0) * 100) / 100;
  const totals = loadTotals(rows);
  const sheetTitles = useMemo(() => sheets.map((sheet) => sheet.title), [sheets]);
  const columns = useMemo(() => hoursColumns(sheetTitles), [sheetTitles]);
  const shown = useMemo(() => shownHoursColumns(sheetTitles), [sheetTitles]);

  if (catalogues.isLoading) return <ScreenLoading label="Adding up the hours…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;
  if (!termIds.length) {
    return (
      <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
        No sections yet. Groups &amp; CRNs is where they are made.
      </p>
    );
  }

  return (
    <section>
      {/* The semester decides every number below it, so it is asked first. */}
      <div className="mb-4">
        <LabelledPicker label="Semester">
          <SelectMenu
            label="Semester"
            value={chosenTerm}
            onChange={setTermId}
            options={termIds.map((id) => ({ value: id, label: termName(id) }))}
          />
        </LabelledPicker>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Teachers" value={String(totals.teachers)} hint="with hours this semester" />
        <Tile label="Hours in all" value={String(totals.hours)} hint={`across ${totals.sections} section${totals.sections === 1 ? "" : "s"}, as we planned them`} />
        <Tile
          label="Registrar hours"
          value={termCode ? String(registrarTotal) : "—"}
          hint={termCode ? (booked.data ? "booked on the portal's timetable, for our teachers" : "reading the sweep…") : "no portal term linked"}
        />
        <Tile
          label="Nobody yet"
          value={String(totals.unnamed)}
          hint={totals.unnamed ? "hours with no teacher named" : "every section has somebody"}
          alarm={totals.unnamed > 0}
        />
        <Tile label="Cohorts" value={String(sheetTitles.length)} hint={sheetTitles.map(hoursColumn).join(", ") || "none"} />
      </div>

      <div className="mt-4">
        <ListGrid
          key={chosenTerm}
          columns={columns}
          rows={rows}
          idOf={(row) => row.teacherId || row.teacher || "nobody"}
          labelOf={(row) => row.teacher || "Nobody yet"}
          layoutKey="scen-columns:teacher-hours:v1"
          presetKey="scen-copy-presets:teacher-hours:v1"
          shown={shown}
          initialSort={{ key: "total", ascending: false }}
          searchLabel="Search teachers"
          noun="teachers"
          empty="No hours this semester. A section's hours are set on Groups & CRNs."
          renderCell={renderCell}
          onRowClick={(row) => {
            if (!row.teacher || !onOpenTeacher) return;
            onOpenTeacher(row.active ?? { id: row.teacherId, fullName: row.teacher });
          }}
        />
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        The same count the timetable workbook&apos;s Teacher Hours sheet carries, from the same rows — with the hours
        nobody is teaching shown, which the sheet leaves out. Hours a section does not state are its course&apos;s.
        Registrar hours are what the portal&apos;s timetable has booked for the sections it staffs with each teacher.
        Cancelled and covered hours come from the notes on the CRNs&apos; calendars. All three sit beside the plan, not
        inside it.
      </p>
    </section>
  );
}

/*
 * A nought is not a number worth printing.
 *
 * Every teacher is absent from most cohorts, so a table that prints its noughts is mostly
 * noughts, and the eye has to read each one to find out it says nothing. A hyphen says the
 * same thing and gets out of the way; the total is what the eye is running down.
 */
const renderCell = (row: LoadRow, column: GridColumn<LoadRow>) => {
  // "Nobody yet" is the one that wants acting on; a name nobody has confirmed is only
  // a name nobody has confirmed.
  if (column.id === "standing") {
    return (
      <StatePill tone={row.standing === "Nobody yet" ? "bad" : row.standing === "Confirmed" ? "accent" : "muted"}>
        {row.standing}
      </StatePill>
    );
  }
  if (column.type !== "number") return undefined;
  const value = Number(column.accessor(row)) || 0;
  if (!value) return <span className="text-[#d5dce4]">—</span>;
  // Hours the semester took away read red, hours it added read blue; the plan stays black.
  if (column.id === "cancelledHours" || column.id === "coverTaken") return <span className="text-[#a6292f]">−{value}</span>;
  if (column.id === "coverGiven") return <span className="text-[#1f4e79]">+{value}</span>;
  return <span className={column.id === "total" ? "font-semibold text-[#171717]" : undefined}>{value}</span>;
};
