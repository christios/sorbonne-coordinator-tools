import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import { HourWindowPicker } from "@/components/HourWindowPicker";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ListGrid, StatePill } from "@/components/ListGrid";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { CommentThread } from "@/components/CommentThread";
import { CommentPeek } from "@/components/CommentPeek";
import { Modal } from "@/components/Modal";
import { datesOf, isWholeSemester, WHOLE_SEMESTER, type HourWindow } from "@/services/hourWindow";
import { academicYearOfTerm, hoursRowsFor, type HoursSource } from "@/services/teacherHoursRows";
import { downloadTeacherHours, periodsCovering } from "@/services/hoursExport";
import { opensOnFor, periodChoices, periodEnd, PERIOD_OPENS_ON } from "@/services/payPeriods";
import {
  fetchPayCycles,
  fetchTeacherCommentCounts,
  fetchTeacherSummary,
  listEverySubmittedTimeSheet,
} from "@/services/teachers";
import type { TeacherRef } from "@/components/TeacherRecord";
import { usePageState } from "@/components/usePageState";
import { buildCards } from "@/services/courseCards";
import {
  fetchActiveCourses,
  fetchActiveCrns,
  fetchActiveTeachers,
  fetchFacilityHours,
  fetchChecks,
  fetchFacilitySections,
  fetchTermLinks,
} from "@/services/portalLists";
import { fetchSessionChanges } from "@/services/sessionChanges";
import { requestSheets } from "@/services/timetableExport";
import {
  crnsByTeacher,
  hoursColumns,
  loadRows,
  shownHoursColumns,
  teacherLoads,
  type LoadRow,
} from "@/services/teacherLoad";
import { loadLayout, visibleColumns, type GridColumn } from "@/services/studentColumns";
import { fetchCohorts, fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";
import { TEACHER_THREAD } from "@/services/threads";
import { DEFAULT_APART, type Severity } from "@/services/teacherWarnings";
import { dismissalsByKey, fetchDismissals, setDismissal } from "@/services/warningDismissals";

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
  const [termId, setTermId] = usePageState("teacher-hours:term", "");

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
  /*
   * And what was actually taught in one pay period, which is a different question from
   * every other column here. Those are the semester's plan; this is the registrar's own
   * dated meetings, less the cancelled and with covers moved to whoever stood in — the
   * figure a part-time claim is settled against.
   */
  const cycles = useQuery({ queryKey: ["pay-cycles"], queryFn: fetchPayCycles });
  const opensOn = opensOnFor(cycles.data?.cycles ?? {}, chosenTerm, cycles.data?.default ?? PERIOD_OPENS_ON);
  const [chosenWindow, setWindow] = usePageState<HourWindow>("teacher-hours:window", WHOLE_SEMESTER);
  const [commentingOn, setCommentingOn] = useState<{ id: string; label: string } | null>(null);
  /*
   * The other three places a teacher's hours are written down, so the column can tell
   * whether they agree: their requisitions, the sheets the timesheets app has approved,
   * and the department's own idea of how far apart is far enough to mention.
   */
  const contracts = useQuery({ queryKey: ["teacher-summary"], queryFn: fetchTeacherSummary });
  const submitted = useQuery({ queryKey: ["submitted-time-sheets", "all"], queryFn: listEverySubmittedTimeSheet, retry: false });
  const checks = useQuery({ queryKey: ["checks", ""], queryFn: () => fetchChecks(""), retry: false });
  const dismissals = useQuery({ queryKey: ["warning-dismissals"], queryFn: fetchDismissals, retry: false });
  const commentCounts = useQuery({ queryKey: ["teacher-comment-counts"], queryFn: fetchTeacherCommentCounts, retry: false });
  const apart = checks.data?.find((check) => check.name === "teacher_hours_apart");
  const client = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ key, dismissed }: { key: string; dismissed: boolean }) => setDismissal(key, dismissed),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["warning-dismissals"] }),
  });
  const decided = useMemo(() => dismissalsByKey(dismissals.data ?? []), [dismissals.data]);
  const periods = useMemo(() => periodChoices(new Date(), 14, 1, opensOn), [opensOn]);
  const counting = datesOf(chosenWindow);
  const whole = isWholeSemester(chosenWindow);
  const owners = useMemo(() => {
    const held = new Map<string, { id: string; name: string }>();
    for (const row of loadRows(teacherLoads(sheets), teachers.data ?? [], crnsByTeacher(sheets))) {
      for (const crn of row.crns) held.set(crn, { id: row.active?.id ?? row.teacherId, name: row.teacher });
    }
    return held;
  }, [sheets, teachers.data]);
  const everyCrn = useMemo(() => [...owners.keys()], [owners]);
  const met = useQuery({
    queryKey: ["facility-sections", termCode, everyCrn.join(",")],
    queryFn: () => fetchFacilitySections(termCode, everyCrn),
    enabled: Boolean(termCode) && everyCrn.length > 0,
    retry: false,
  });

  /*
   * The whole semester is the plan; anything narrower is what happened.
   *
   * The plan has no dates on it — a section is twenty-one hours for the term — so it
   * cannot answer "what did she teach in October". The registrar's dated meetings can,
   * and they are laid out the same way, cohort by cohort, so the table does not change
   * shape when the question narrows. Every column then carries the window's mark, because
   * a table of October's hours otherwise reads exactly like a table of the year's.
   */
  const today = new Date().toISOString().slice(0, 10);
  /*
   * Everything the table is made of, gathered once.
   *
   * The arranging lives in a service, because the export asks the same question of every
   * pay period in the semester and has to get the same answers this page shows.
   */
  const source: HoursSource = useMemo(
    () => ({
      sheets,
      teachers: teachers.data ?? [],
      notes: notes.data ?? [],
      sections: met.data?.sections ?? [],
      booked: booked.data ?? {},
      owners,
      submitted: submitted.data ?? [],
      contracts: contracts.data ?? {},
      academicYear: academicYearOfTerm(termCode),
      decided,
      threshold: apart?.enabled === false ? Number.POSITIVE_INFINITY : (apart?.threshold ?? DEFAULT_APART),
      today,
    }),
    [sheets, teachers.data, notes.data, met.data, booked.data, owners, submitted.data, contracts.data, termCode,
     decided, apart?.enabled, apart?.threshold, today],
  );
  const rows = useMemo(
    () => hoursRowsFor(source, counting, whole),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the window is read as two dates
    [source, counting.from, counting.to, whole],
  );
  const sheetTitles = useMemo(() => sheets.map((sheet) => sheet.title), [sheets]);
  /*
   * Every pay period the semester's teaching falls in, from the days classes actually
   * meet. A list from the calendar would put sheets in the file for months nothing was
   * taught in, and a coordinator would have to work out which ones to ignore.
   */
  const semesterPeriods = useMemo(
    () =>
      periodsCovering(
        (met.data?.sections ?? []).flatMap((section) => section.meetings.map((meeting) => meeting.meetsOn)),
        opensOn,
      ),
    [met.data, opensOn],
  );
  const [exporting, setExporting] = useState(false);
  const exportHours = async () => {
    setExporting(true);
    try {
      const layout = loadLayout(hoursColumns(sheetTitles), "scen-columns:teacher-hours:v1", shownHoursColumns(sheetTitles));
      await downloadTeacherHours(
        {
          semester: termName(chosenTerm),
          // What is on screen, in the order it is on screen: a hidden cohort column is
          // hidden in the file too, or the export is a different table with the same name.
          columns: visibleColumns(layout, hoursColumns(sheetTitles)),
          plan: hoursRowsFor(source, datesOf(WHOLE_SEMESTER), true),
          periods: semesterPeriods.map((start) => ({
            start,
            rows: hoursRowsFor(source, { from: start, to: periodEnd(start) }, false),
          })),
        },
        `Teacher hours — ${termName(chosenTerm)}.xlsx`,
      );
    } finally {
      setExporting(false);
    }
  };
  const columns = useMemo(() => hoursColumns(sheetTitles, chosenWindow.tag), [sheetTitles, chosenWindow.tag]);
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
      {/*
        * Both controls on one line. They are one question — which semester, and which
        * stretch of it — and stacking them put a page of tiles between the two halves.
        */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <LabelledPicker label="Semester">
          <SelectMenu
            label="Semester"
            value={chosenTerm}
            onChange={setTermId}
            options={termIds.map((id) => ({ value: id, label: termName(id) }))}
          />
        </LabelledPicker>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
            Counting
            <span className="ml-1.5 font-normal normal-case text-[#98a2b3]">
              {whole ? "the semester as planned" : "what actually met in it"}
            </span>
          </p>
          <HourWindowPicker window={chosenWindow} periods={periods} onChange={setWindow} />
        </div>
        {/*
          * The file a meeting is held around. It is the table on screen — these columns,
          * in this order — laid out a pay period to a sheet, with a master sheet that
          * adds them up by formula rather than by having been right once.
          */}
        <button
          type="button"
          onClick={() => void exportHours()}
          disabled={exporting || !rows.length}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
        >
          <Download size={15} aria-hidden="true" />
          {exporting ? "Building…" : "Export"}
        </button>
      </div>

      {commentingOn ? (
        <Modal
          open
          onClose={() => setCommentingOn(null)}
          title={`Comments on ${commentingOn.label}`}
          description="Said to everybody who opens this teacher, and kept with them."
        >
          <CommentThread studentId={commentingOn.id} label={commentingOn.label} thread={TEACHER_THREAD} />
        </Modal>
      ) : null}

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
          renderCell={(row, column) =>
            column.id === "warnings" ? (
              <Warnings row={row} onDecide={(key, dismissed) => decide.mutate({ key, dismissed })} />
            ) : (
              renderCell(row, column)
            )
          }
          /*
           * On the row, beside its tick box, as the Students table has them: in view when
           * there is something to read, and under the pointer when there is not. At the far
           * end of a wide table they were a column nobody scrolled to.
           */
          rowLead={(row) => {
            const id = row.active?.partTimeTeacherId || row.active?.id || "";
            if (!id) return null;
            const count = commentCounts.data?.[id]?.count ?? 0;
            return (
              <CommentPeek
                studentId={id}
                label={row.teacher}
                count={count}
                onOpen={() => setCommentingOn({ id, label: row.teacher })}
                className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] tabular-nums hover:bg-[#f2f7fb] ${
                  count ? "text-[#1f4e79]" : "text-[#98a2b3] opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                }`}
              />
            );
          }}
          onRowClick={(row) => {
            if (!row.teacher || !onOpenTeacher) return;
            onOpenTeacher(row.active ?? { id: row.teacherId, fullName: row.teacher });
          }}
        />
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        The same count the timetable workbook&apos;s Teacher Hours sheet carries, from the same rows — with the hours
        nobody is teaching shown, which the sheet leaves out. Hours a section does not state are its course&apos;s.
        Portal hours are what the portal&apos;s timetable has booked for the sections it staffs with each teacher.
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
  /*
   * The total carries its own arrow, before the blank below: a teacher whose every class
   * was cancelled has a total of zero, and zero with a red arrow on it is the most
   * important row on the page, where a dash would say "nothing to see".
   */
  // The arrow is the distance from the plan, and a window has no plan to be a distance from.
  if (column.id === "total") return column.window ? <span className="font-semibold text-[#171717]">{value}</span> : <Taught row={row} taught={value} />;
  if (!value) return <span className="text-[#d5dce4]">—</span>;
  // Hours the semester took away read red, hours it added read blue; the plan stays black.
  if (column.id === "cancelledHours" || column.id === "coverTaken") return <span className="text-[#a6292f]">−{value}</span>;
  if (column.id === "coverGiven") return <span className="text-[#1f4e79]">+{value}</span>;
  return <span className={column.id === "total" ? "font-semibold text-[#171717]" : undefined}>{value}</span>;
};

/**
 * The hours they taught, and how far that is from the hours they were down for.
 *
 * The arrow is the whole point: the number alone cannot say whether it is the plan or
 * something that happened to the plan, and a coordinator reading a table of forty rows
 * should be able to see which ones moved without reading three more columns.
 */
function Taught({ row, taught }: { row: LoadRow; taught: number }) {
  const moved = Math.round((taught - row.total) * 100) / 100;
  const why = [
    `Planned ${row.total} h`,
    row.cancelledHours ? `${row.cancelledHours} h cancelled` : "",
    row.coverTaken ? `${row.coverTaken} h taught by somebody else` : "",
    row.coverGiven ? `${row.coverGiven} h taught for somebody else` : "",
  ].filter(Boolean).join(" · ");
  return (
    <span className="inline-flex items-baseline gap-1" title={why}>
      <span className="font-semibold text-[#171717]">{taught || (row.total ? 0 : "—")}</span>
      {moved ? (
        <span className={`inline-flex items-baseline gap-0.5 text-xs ${moved > 0 ? "text-[#1f6b47]" : "text-[#a6292f]"}`}>
          {moved > 0 ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
          {Math.abs(moved)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * How loudly a pill says itself.
 *
 * Three, not two: everything red says nothing, and nothing red says less. The department's
 * own threshold decides which is which, so a page of pills sorts itself into the ones to
 * act on and the ones to know about without anybody reading the numbers.
 */
const TONES: Record<Severity, string> = {
  high: "bg-[#fdf3f3] text-[#a6292f]",
  medium: "bg-[#fdf6e3] text-[#8a6116]",
  low: "bg-[#eef4fa] text-[#1f4e79]",
};

/**
 * Where a teacher's hours disagree with themselves, one pill per disagreement.
 *
 * The pill says the kind and the size — "Registrar short 6 h" — and the whole sentence is
 * on its title, because this column sits beside a dozen others and a sentence cut to fit
 * has said nothing while taking the room of something that would have.
 *
 * Dismissing is for everybody and is signed, like the cohorts page's: a warning hidden
 * from a colleague who never saw it should at least say who hid it, so it reads as a
 * decision somebody can disagree with rather than as an absence.
 */
function Warnings({ row, onDecide }: { row: LoadRow; onDecide: (key: string, dismissed: boolean) => void }) {
  if (!row.warnings.length) return <span className="text-[#d5dce4]">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {row.warnings.map((warning) => (
        <span
          key={warning.key}
          title={
            warning.dismissed
              ? `${warning.sentence} — dismissed by ${warning.dismissedBy || "somebody"}`
              : warning.sentence
          }
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            warning.dismissed ? "bg-[#f2f4f7] text-[#98a2b3]" : TONES[warning.severity]
          }`}
        >
          <span className="min-w-0 truncate">{warning.label}</span>
          {warning.dismissed && warning.dismissedBy ? (
            <span className="min-w-0 shrink truncate font-normal">· {warning.dismissedBy}</span>
          ) : null}
          <button
            type="button"
            aria-label={`${warning.dismissed ? "Restore" : "Dismiss"}: ${warning.sentence}`}
            title={
              warning.dismissed
                ? "Bring this warning back for everybody"
                : "Dismiss for everybody, until either figure changes"
            }
            onClick={(event) => {
              event.stopPropagation();
              onDecide(warning.key, !warning.dismissed);
            }}
            className="-mr-1 shrink-0 rounded-full p-0.5 hover:bg-white/70"
          >
            {warning.dismissed ? <RotateCcw size={10} aria-hidden="true" /> : <X size={10} aria-hidden="true" />}
          </button>
        </span>
      ))}
    </span>
  );
}
