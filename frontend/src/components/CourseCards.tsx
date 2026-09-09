import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { AddFromPortal } from "@/components/AddFromPortal";
import { CourseDetail } from "@/components/CourseDetail";
import { WarningBanner, WarningRows, type WarningKind } from "@/components/WarningBanner";
import type { FillReport } from "@/components/FillBlock";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { ScreenLoading } from "@/components/ScreenLoading";
import { TableFilterBar } from "@/components/TableFilterBar";
import { useRemembered } from "@/components/useRemembered";
import { WorkbookTools } from "@/components/WorkbookTools";
import { afterPlacement } from "@/services/afterPlacement";
import { buildCards, cardColumns, type Card } from "@/services/courseCards";
import { fetchActiveCourses, fetchActiveCrns, fetchActiveTeachers, fetchRegisterCheck, fetchTermCrns } from "@/services/portalLists";
import { fetchPublication } from "@/services/publication";
import { clashName, clashesIn, describeClashCoverage } from "@/services/publicationView";
import { type Cohort, fetchCourseCards } from "@/services/studentDatabase";
import { optionsFor, plainCellText } from "@/services/studentColumns";
import { COHORT } from "@/services/remembered";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import { downloadTimetableWorkbook, requestSheets } from "@/services/timetableExport";
import { shortYear } from "@/services/workbookExport";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * Groups & CRNs as the department's timetable request: one list of course cards.
 *
 * Every cohort, every semester, one card per course, narrowed by the same filter chips
 * and search box the tables have — and opened to show the sections inside. The sets those
 * sections sit in are the Group schema page's, one entry down the sidebar; the files are
 * at the foot of the list, since a course arrives in it.
 */
/**
 * One course in the list on the left: its code, its name, and what is wrong with it.
 *
 * The dot is the whole of the summary — red where a section has no CRN, amber where one
 * has nobody teaching it, green where there is nothing to do — because a list is read by
 * running down it, and a list of sentences is not read at all.
 */
function CourseLine({ card, chosen, onChoose }: { card: Card; chosen: boolean; onChoose: () => void }) {
  const rows = card.sets.flatMap((set) => set.rows).filter((row) => !row.section?.retired);
  const crnless = rows.filter((row) => !row.section?.crn).length;
  const unstaffed = rows.filter((row) => row.section?.crn && !row.section.teacherId && !row.section.teacher).length;
  const dot = crnless ? "bg-[#a6292f]" : unstaffed ? "bg-[#d99b1c]" : "bg-[#2e7d55]";

  return (
    <button
      type="button"
      onClick={onChoose}
      aria-current={chosen ? "true" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${chosen ? "bg-[#e8edf3]" : "hover:bg-[#f6f8fb]"}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" title={crnless ? `${crnless} without a CRN` : unstaffed ? `${unstaffed} with nobody teaching` : "nothing missing"} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm tabular-nums ${chosen ? "font-semibold text-[#1f4e79]" : "text-[#344054]"}`}>{card.code}</span>
        <span className="block truncate text-xs text-[#98a2b3]">{card.name || "untitled"}</span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-[#98a2b3]">{rows.length}</span>
    </button>
  );
}

export function CourseCards({
  cohorts,
  onShowStudents,
  onPlaceStudents,
  header,
}: {
  cohorts: Cohort[];
  onShowStudents?: (studentIds: string[]) => void;
  /** Off to the Cohorts page, on this cohort and these students: where placing is done. */
  onPlaceStudents?: (cohortId: string, studentIds: string[]) => void;
  /** The slot beside the page's title, where the cohort and the files go. */
  header?: HTMLElement | null;
}) {
  const client = useQueryClient();
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  // The department's courses: a card's title, UE and parent CRN are read from here.
  const activeCourses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  // The register: what each CRN hangs from, which the workbook's Parent CRN column is.
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });
  /*
   * Which sections the registrar staffs differently from our planning — the server's
   * verdict, fetched once for the list rather than decided per card.
   *
   * `retry: false`, and an empty set when it cannot be had: a card that cannot reach this
   * shows no "Portal: …" line, which is the same thing it showed before there was one.
   * Being unable to check must not look like having checked.
   */
  const drift = useQuery({ queryKey: ["register-check", ""], queryFn: () => fetchRegisterCheck(), retry: false });
  const teacherDrift = useMemo(
    () => new Set((drift.data?.teacherDiffers ?? []).map((row) => row.crn)),
    [drift.data],
  );
  const parentOf = useMemo(
    () => new Map((registered.data ?? []).filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn])),
    [registered.data],
  );
  const termName = (termId: string) => (terms.data ?? []).find((term) => term.id === termId)?.name ?? (termId ? "unknown semester" : "");
  const cards = useMemo(() => buildCards(catalogues.data ?? [], termName, activeCourses.data ?? [], parentOf), [catalogues.data, terms.data, activeCourses.data, parentOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const termIds = useMemo(() => [...new Set(cards.map((card) => card.termId).filter(Boolean))], [cards]);

  // What the platform makes of each semester, and what the portal lists for it: one
  // fetch per semester on the page, whichever cards are open.
  const publications = useQueries({
    queries: termIds.map((termId) => ({ queryKey: ["publication", termId], queryFn: () => fetchPublication(termId), retry: false })),
  });
  const portals = useQueries({
    queries: termIds.map((termId) => ({ queryKey: ["portal-crns", termId], queryFn: () => fetchTermCrns(termId), retry: false })),
  });
  const publicationOf = (termId: string) => publications[termIds.indexOf(termId)]?.data ?? null;
  const portalOf = (termId: string) => {
    const held = portals[termIds.indexOf(termId)]?.data;
    return held?.portalTermCode ? held : null;
  };

  const nameOf = (teacherId: string) => (teachers.data ?? []).find((teacher) => teacher.id === teacherId)?.fullName ?? "";
  const columns = useMemo(() => cardColumns(nameOf), [teachers.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFilters] = useState<FilterModel[]>([]);
  // The two panes fill the room under the toolbar, and each scrolls inside itself.
  const [query, setQuery] = useState("");
  /*
   * One cohort at a time.
   *
   * Every year's courses in one list read as a wall: the cohort is the unit the work is
   * done in, and the chip on each card was doing the job a picker should. Sets open to
   * every cohort stay on screen whichever is chosen, because they are everyone's.
   *
   * Remembered by this browser, and shared with Capacity and the Group schema: the year
   * being worked on is one answer, not one per page and not one per visit.
   */
  const [cohortId, setCohortId] = useRemembered(COHORT);
  // Which course the detail is showing; empty until one is picked, and the first is shown.
  const [cardKey, setCardKey] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const searched = needle ? cards.filter((card) => columns.some((column) => plainCellText(card, column).toLowerCase().includes(needle))) : cards;
    return applyFilters(searched, columns, filters);
  }, [cards, columns, filters, query]);

  const [tools, setTools] = useState(false);
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestTerm, setRequestTerm] = useState("");
  const [building, setBuilding] = useState(false);
  const [filled, setFilled] = useState<FillReport | null>(null);

  const refresh = () => {
    // What this page's own edits change — a CRN, a course joining the register, a card.
    client.invalidateQueries({ queryKey: ["course-cards"] });
    client.invalidateQueries({ queryKey: ["active-courses"] });
    client.invalidateQueries({ queryKey: ["active-crns"] });
    // And everything a change of placement changes, since Fill places students. The
    // register's verdict is in there: filling a group changes which sections those
    // students are expected to be registered in.
    afterPlacement(client);
  };
  // The one chosen, or the first with courses on it — landing on an empty year would look
  // like the page had nothing at all.
  const chosen =
    cohorts.find((cohort) => cohort.id === cohortId) ??
    cohorts.find((cohort) => cards.some((card) => card.cohortId === cohort.id)) ??
    cohorts[0] ??
    null;

  if (catalogues.isLoading) return <ScreenLoading label="Loading the courses…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;

  // The clash panel belongs to one cohort in one semester; it shows when the list is one.
  // A course whose every set is open to every cohort is the department's, not a year's.
  const acrossCohorts = visible.filter((card) => card.sets.length > 0 && card.sets.every((set) => set.scope.openToAll));
  const byCohort = visible.filter((card) => !acrossCohorts.includes(card) && (!chosen || card.cohortId === chosen.id));
  /*
   * One course at a time.
   *
   * Fifteen boxes to open one by one, each opening onto a ten-column table that scrolled
   * sideways inside it, was not how the work is done. The names stand on the left with
   * what is wrong with each; everything a course has to say is said on the right, where
   * there is room to say it.
   */
  const listed = [...byCohort, ...acrossCohorts];
  const chosenCard = listed.find((card) => card.key === cardKey) ?? listed[0] ?? null;
  const shownPublication = chosenCard ? publicationOf(chosenCard.termId) : null;
  const clashes = shownPublication && chosenCard ? clashesIn(shownPublication, chosenCard.cohortId) : null;
  const unassignedOf = (card: typeof chosenCard) =>
    (card ? shownPublication?.cohorts.find((entry) => entry.cohortId === card.cohortId)?.unassigned : null) ?? {};
  // Only the overlaps somebody is actually caught by; the rest are a constraint on the
  // fill, not a thing that has gone wrong.
  const trapped = (clashes ?? []).filter((clash) => clash.students.length);
  // What the clash counts on this page do not cover — said once, and used twice.
  const coverage = describeClashCoverage(shownPublication?.coverage);
  const caught = new Set(trapped.flatMap((clash) => clash.students));

  /*
   * What needs attention, counted rather than recited.
   *
   * The clashes used to be written out in full above the courses — five lines each,
   * twenty-two of them — which buried the page they were about. These are the same facts,
   * as counts that open.
   */
  const troubled = listed.flatMap((card) =>
    card.sets.flatMap((set) =>
      set.rows
        .filter((row) => !row.section?.retired && !row.section?.crn)
        .map((row) => ({ card, set, row })),
    ),
  );
  const leftOver = Object.entries(unassignedOf(chosenCard)).filter(([, ids]) => ids.length);
  const warnings: WarningKind[] = [
    troubled.length
      ? {
          id: "crn",
          severity: "serious" as const,
          label: `${troubled.length} section${troubled.length === 1 ? "" : "s"} without a CRN`,
          detail: (
            <WarningRows more={Math.max(0, troubled.length - 8)}>
              {troubled.slice(0, 8).map(({ card, set, row }) => (
                <li key={`${card.key}|${row.group.id}`} className="flex items-baseline gap-3 px-4 py-2">
                  <button type="button" onClick={() => setCardKey(card.key)} className="font-medium text-[#1f4e79] underline-offset-2 hover:underline">
                    {card.code}
                  </button>
                  <span className="text-[#667085]">{set.scope.code} {row.group.label}</span>
                </li>
              ))}
            </WarningRows>
          ),
        }
      : null,
    trapped.length
      ? {
          id: "clashes",
          /*
           * Two groups meeting at the same hour is not a fault: they are different classes
           * and most students are in one of them. It is only a fault for the students who
           * are in BOTH, who cannot attend either properly — so those are what is counted,
           * and a pair nobody is caught by is not mentioned. The fill planner still knows
           * about every overlap; it is what stops it creating more of these.
           */
          severity: "serious" as const,
          label: `${caught.size} student${caught.size === 1 ? " is" : "s are"} in two groups at the same hour`,
          detail: (
            <WarningRows more={Math.max(0, trapped.length - 8)}>
              {trapped.slice(0, 8).map((clash) => (
                <li key={clash.groups.map((group) => group.id).join("|")} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2">
                  <span className="font-medium text-[#344054]">{clashName(clash)}</span>
                  <span className="text-xs text-[#98a2b3]">
                    {clash.windows.length} overlapping hour{clash.windows.length === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto text-xs text-[#a6292f]">
                    {clash.students.length} in both
                  </span>
                  {onShowStudents ? (
                    <button type="button" onClick={() => onShowStudents(clash.students)} className="text-xs font-semibold text-[#1f4e79] underline">
                      Show them
                    </button>
                  ) : null}
                </li>
              ))}
            </WarningRows>
          ),
        }
      : null,
    leftOver.length
      ? {
          id: "unplaced",
          severity: "caution" as const,
          label: `${leftOver.reduce((sum, [, ids]) => sum + ids.length, 0)} placements to make`,
          detail: (
            <WarningRows>
              {leftOver.map(([code, ids]) => (
                <li key={code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                  <span className="font-medium text-[#1f4e79]">{code}</span>
                  <span className="text-[#667085]">
                    {ids.length} student{ids.length === 1 ? "" : "s"} with no group
                  </span>
                  {onPlaceStudents && chosenCard ? (
                    <button
                      type="button"
                      onClick={() => onPlaceStudents(chosenCard.cohortId, ids)}
                      className="ml-auto text-xs font-semibold text-[#1f4e79] underline"
                    >
                      Place them
                    </button>
                  ) : null}
                </li>
              ))}
            </WarningRows>
          ),
        }
      : null,
  ].filter(Boolean) as WarningKind[];

  const pairs = [...new Set(byCohort.map((card) => `${card.cohortId}|${card.termId}`))];
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-72">
        <SelectMenu
          label="Cohort"
          value={chosen?.id ?? ""}
          onChange={setCohortId}
          options={cohorts.map((cohort) => ({
            value: cohort.id,
            label: cohort.name,
            year: cohort.term,
            badge: String(cards.filter((card) => card.cohortId === cohort.id).length),
            badgeTone: cards.some((card) => card.cohortId === cohort.id) ? ("accent" as const) : ("muted" as const),
          }))}
        />
      </div>
      <button
        type="button"
        onClick={() => setTools(true)}
        className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <FileSpreadsheet size={15} aria-hidden="true" /> Workbook and lists
      </button>
    </div>
  );

  return (
    <section className="flex flex-col lg:min-h-0 lg:flex-1">
      {/*
        * The cohort and the files sit on the page's own title line.
        *
        * They had a row to themselves, with a caption over the picker — some seventy
        * pixels of the screen spent on one dropdown and one button, and seventy pixels
        * the panes below did not get. The title line was half empty; they are on it.
        * Without a slot to put them in they stay where they were, so the page still
        * works on its own.
        */}
      {header ? createPortal(controls, header) : <div className="mb-3">{controls}</div>}

      {filled ? (
        <p className="mb-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-2.5 text-sm text-[#2f6b3d]">
          {filled.assigned} student{filled.assigned === 1 ? "" : "s"} placed in {filled.scopeCode}{filled.unplaced ? `; ${filled.unplaced} could not be placed` : ""}.
        </p>
      ) : null}

      <WarningBanner title="Needs attention" kinds={warnings} />

      {/*
        * The filter and the search sit directly over the list they narrow.
        *
        * They were above the warnings, two bands away from the thing they act on, which
        * made them read as the page's controls rather than the list's — and left the eye
        * to travel back down past a red banner to see what they had done.
        */}
      {/*
        * Standing off the header above it by as much as it stands off the panes below.
        *
        * It never scrolls away now, so a tight gap made it read as the last line of the
        * page's own heading rather than as the controls belonging to the list under it.
        */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <TableFilterBar columns={columns} filters={filters} optionsFor={(column) => optionsFor(cards, column)} onChange={setFilters} />
        <span className="text-xs text-[#98a2b3]">
          {cards.length} course{cards.length === 1 ? "" : "s"}
          {visible.length !== cards.length ? `, ${visible.length} shown` : ""} · {pairs.length} cohort-semester{pairs.length === 1 ? "" : "s"}
        </span>
        {/*
          * How much of this semester the registrar has actually booked.
          *
          * It used to be said at the end of every Portal sync, where it was an amber
          * warning triangle on a run that had gone perfectly — sections with no room
          * booked yet are what September looks like, so the triangle was permanent and
          * therefore meaningless. It is a fact about this page: it is the error bar on
          * every clash count here, and it is silent once every section has hours.
          */}
        {coverage ? (
          <span className="text-xs text-[#98a2b3]" title="The registrar's timetable, as last swept">
            · {coverage}
          </span>
        ) : null}
        <label className="relative ml-auto block w-full sm:w-64">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input aria-label="Search courses" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses, teachers, CRNs" className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm" />
        </label>
      </div>

      {listed.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
          {cards.length ? "No course matches the filters." : "No courses yet. Add one from the portal, or use the Group schema page to define a semester's sets and their courses."}
        </p>
      ) : (
        /*
          * Two panes, each scrolling inside itself, filling the room under the toolbar.
          *
          * The page used to scroll as one, which took the cohort, the warnings, the filter
          * and the search off the top of the screen the moment you looked down a long list
          * of courses — so choosing a different course meant scrolling back up to find the
          * list you were choosing from. Now nothing above them ever leaves.
          */
        <div className="mt-3 grid items-stretch gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_1fr] lg:overflow-hidden lg:[grid-template-rows:minmax(0,1fr)]">
          <nav aria-label="Courses" className="relative rounded-lg border border-[#d9dee7] bg-white p-1.5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-none">
            {byCohort.map((card) => (
              <CourseLine key={card.key} card={card} chosen={card.key === chosenCard?.key} onChoose={() => setCardKey(card.key)} />
            ))}
            {byCohort.length === 0 && acrossCohorts.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-[#98a2b3]">No courses yet.</p>
            ) : null}
            {acrossCohorts.length ? (
              <>
                <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">Across cohorts</p>
                {acrossCohorts.map((card) => (
                  <CourseLine key={card.key} card={card} chosen={card.key === chosenCard?.key} onChoose={() => setCardKey(card.key)} />
                ))}
              </>
            ) : null}
            {/*
              * Where a course comes from, at the foot of the list of them: a course arrives
              * in this list, so the way to bring one in belongs at the end of it. The files
              * do not — they are the cohort's, and they sit with the cohort picker.
              */}
            <div className="mt-2 space-y-1 border-t border-[#eef1f5] px-1 pt-2">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
              >
                <Plus size={15} aria-hidden="true" /> Add from portal
              </button>
            </div>
          </nav>

          {chosenCard ? (
            <CourseDetail
              key={chosenCard.key}
              card={chosenCard}
              cohort={cohorts.find((cohort) => cohort.id === chosenCard.cohortId) ?? null}
              teachers={teachers.data ?? []}
              portal={portalOf(chosenCard.termId)}
              teacherDrift={teacherDrift}
              action={
                /*
                 * The request is the whole semester's — a sheet per cohort, the CRN table,
                 * the teacher hours — not this course's. It stands where the semester is
                 * named, and says its own breadth so nobody reads it as "this course".
                 */
                <button
                  type="button"
                  onClick={() => {
                    setRequestTerm(chosenCard.termId || termIds[0] || "");
                    setRequesting(true);
                  }}
                  title="The workbook the timetabler gets: every cohort of this semester"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                >
                  <Download size={13} aria-hidden="true" /> Timetable request
                </button>
              }
              unassigned={unassignedOf(chosenCard)}
              clashes={clashes}
              onPlaceStudents={onPlaceStudents}
              onChanged={refresh}
              onFilled={(reportOfFill) => {
                setFilled(reportOfFill);
                refresh();
              }}
            />
          ) : null}
        </div>
      )}

      <Modal
        open={requesting}
        title="Timetable request"
        description="The workbook the timetabler gets: a sheet per cohort for one semester, the CRN table, teacher hours."
        onClose={() => setRequesting(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setRequesting(false)} className="text-sm font-semibold text-[#667085]">Cancel</button>
            <button
              type="button"
              disabled={!requestTerm || building}
              onClick={async () => {
                setBuilding(true);
                try {
                  const sheets = requestSheets(
                    cards,
                    requestTerm,
                    termName(requestTerm),
                    // The Degree column: the cohort's majors as the portal codes them, else its name.
                    (cohortId) => {
                      const cohort = cohorts.find((candidate) => candidate.id === cohortId);
                      return cohort?.majors.join(" / ") || cohort?.name || "";
                    },
                    nameOf,
                    // The sheet's own name, which each cohort answers for itself.
                    (cohortId) => cohorts.find((candidate) => candidate.id === cohortId) ?? { name: "" },
                  );
                  /*
                   * The name the department's own file has: one workbook a year, not one
                   * per semester with the semester spelled out in it.
                   */
                  const year = shortYear(cohorts.find((cohort) => cohort.term)?.term ?? "");
                  await downloadTimetableWorkbook(sheets, `Time-Tables-${year || "request"}.xlsx`, year);
                  setRequesting(false);
                } finally {
                  setBuilding(false);
                }
              }}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {building ? "Building…" : "Download"}
            </button>
          </div>
        }
      >
        <SelectMenu label="Semester" value={requestTerm} onChange={setRequestTerm} placeholder="Which semester…" options={termIds.map((id) => ({ value: id, label: termName(id) }))} />
        {requestTerm ? (
          <p className="mt-3 text-sm text-[#667085]">
            {cards.filter((card) => card.termId === requestTerm).length} course{cards.filter((card) => card.termId === requestTerm).length === 1 ? "" : "s"} across{" "}
            {new Set(cards.filter((card) => card.termId === requestTerm).map((card) => card.cohortId)).size} cohort(s). Teachers come from Active teachers; a section nobody has chosen keeps the portal&apos;s name.
          </p>
        ) : null}
      </Modal>
      {adding ? <AddFromPortal open cohorts={cohorts} terms={terms.data ?? []} activeCourses={activeCourses.data ?? []} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} /> : null}
      <WorkbookTools open={tools} cohorts={cohorts} terms={terms.data ?? []} onClose={() => setTools(false)} />
    </section>
  );
}
