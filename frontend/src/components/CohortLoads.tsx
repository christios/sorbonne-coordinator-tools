import { Search, Settings2 } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { InfoTip } from "@/components/InfoTip";
import { ProgrammeScopeNote } from "@/components/ProgrammeFilterNote";
import { SelectMenu } from "@/components/SelectMenu";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { TeacherRef } from "@/components/TeacherRecord";
import { TeachingLoadsSettings } from "@/components/TeachingLoadsSettings";
import { usePageState } from "@/components/usePageState";
import { useRemembered } from "@/components/useRemembered";
import {
  BUCKETS,
  LOAD_KINDS,
  STAFF_STATUSES,
  bucketLabel,
  bucketOf,
  cohortLoads,
  departmentKinds,
  departmentSplit,
  departmentTeachers,
  everyCohortLoad,
  loadSections,
  shareOf,
  splitTotal,
  type Bucket,
  type CohortLoad,
  type LoadKind,
  type LoadSection,
  type Split,
  type StaffStatus,
} from "@/services/cohortLoads";
import type { Card } from "@/services/courseCards";
import { NO_COURSE_PROGRAMS, programmeName, type CoursePrograms } from "@/services/coursePrograms";
import type { ActiveTeacher } from "@/services/portalLists";
import { TEACHING_LOADS_HIDDEN, TEACHING_LOADS_PROGRAM } from "@/services/remembered";
import { optionsFor, type GridColumn } from "@/services/studentColumns";
import { ALL_COHORTS } from "@/services/studentDatabase";
import { applyFilters, type FilterModel } from "@/services/tableFilter";

const DEPARTMENT = "department";

/**
 * What each full-timer owes of the year's service once their hour reductions are taken off
 * (Budget → Hour reductions), by their Active teachers row.
 */
export type TeachingOwed = Record<string, { owed: number; service: number; reductions: number }>;
const NO_OWED: TeachingOwed = {};
const hours = (value: number) => (Math.round(value * 10) / 10).toLocaleString("en-GB");

/*
 * The status tags. Each is the darkest of its colour on the lightest, with an outline a
 * step darker than the fill, so a tag reads on white and on the grey of a course line.
 */
const PILL: Record<Bucket, string> = {
  FT: "bg-[#d7f0e5] text-[#064e3b] ring-[#6cc5a0]",
  PHD: "bg-[#ece9e1] text-[#3d3b37] ring-[#a8a59b]",
  VP: "bg-[#fbe2d8] text-[#6b2410] ring-[#e39a7c]",
  PT: "bg-[#e5e3fb] text-[#2e2878] ring-[#a29ce8]",
  UNSET: "bg-[#fdebc8] text-[#5c3305] ring-[#e3ab52]",
  NOBODY: "bg-[#fde3e3] text-[#8a1c1c] ring-[#e89393]",
};

function Tag({ bucket, title }: { bucket: Bucket; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset ${PILL[bucket]}`}
    >
      {bucketLabel(bucket)}
    </span>
  );
}

/** A teacher's status beside their name. A question mark until it is known. */
function StatusPill({ status }: { status: StaffStatus | "" }) {
  const long = STAFF_STATUSES.find((entry) => entry.status === status)?.long ?? "No status yet: set it on the teacher's record";
  return (
    <span className="ml-1.5">
      {status ? (
        <Tag bucket={status} title={long} />
      ) : (
        <span title={long} className={`inline-block rounded px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset ${PILL.UNSET}`}>
          ?
        </span>
      )}
    </span>
  );
}

/**
 * The hours and their share in a cell, or a dash for none. The share is a tag of its own,
 * in its status's colour and of one width, so the shares read down a column apart from
 * the hours beside them.
 */
function HoursShare({ value, total, bucket }: { value: number; total: number; bucket: Bucket }) {
  if (!value) return <span className="text-[#667085]">–</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className={bucket === "NOBODY" ? "font-semibold text-[#a6292f]" : "text-[#171717]"}>{hours(value)}</span>
      <span
        className={`inline-block min-w-[3.25rem] rounded px-1.5 py-px text-center text-xs font-semibold ring-1 ring-inset ${PILL[bucket]}`}
      >
        {shareOf(value, total)}
      </span>
    </span>
  );
}

const lineCell = "border-b border-[#dde3ea] py-1.5";

/**
 * Who teaches the hours: the sheet's FT, PhD/Pdoc, VP and PT, with each one's share,
 * semester by semester and for the year. A line for hours whose teacher has no status,
 * and one for hours nobody teaches yet, only when there are any — so the total is always
 * the hours counted, and the shares say what is still open.
 */
function SplitTable({ split, termIds, termLabel }: { split: Record<string, Split>; termIds: string[]; termLabel: (id: string) => string }) {
  const columns = [...termIds.filter((id) => split[id]), "year"];
  const shownBuckets = BUCKETS.filter(
    (bucket) => STAFF_STATUSES.some((entry) => entry.status === bucket) || columns.some((id) => split[id][bucket] > 0),
  );
  return (
    <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
      <thead>
        <tr className="text-xs text-[#344054]">
          <th className="border-b-2 border-[#b8c2cf] py-1.5 pr-3 text-left font-semibold">Status</th>
          {columns.map((id) => (
            <th key={id} className="whitespace-nowrap border-b-2 border-[#b8c2cf] py-1.5 pl-4 text-right font-semibold">
              {id === "year" ? "Year" : termLabel(id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shownBuckets.map((bucket) => (
          <tr key={bucket}>
            <td className={`${lineCell} pr-3`}>
              <Tag bucket={bucket} />
            </td>
            {columns.map((id) => (
              <td key={id} className={`${lineCell} whitespace-nowrap pl-4 text-right`}>
                <HoursShare value={split[id][bucket]} total={splitTotal(split[id])} bucket={bucket} />
              </td>
            ))}
          </tr>
        ))}
        <tr className="font-semibold text-[#171717]">
          <td className="border-t-2 border-[#b8c2cf] py-1.5 pr-3">Total</td>
          {columns.map((id) => (
            <td key={id} className="border-t-2 border-[#b8c2cf] py-1.5 pl-4 text-right">
              {hours(splitTotal(split[id]))}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

const card = "rounded-lg border border-[#c9d2de] bg-white p-4";

/** A section as the search and the filters read it. */
type Row = LoadSection & { semester: string; course: string; typeLabel: string; teacherShown: string; statusShown: string; cohortShown: string };

const option = (id: string, displayName: string, accessor: (row: Row) => string): GridColumn<Row> => ({
  id,
  displayName,
  type: "option",
  accessor,
  defaultWidth: 140,
});
/** Everything a section can be filtered on, as the other pages' tables can be. */
const COLUMNS: GridColumn<Row>[] = [
  // Which cohort a section is of: what narrows All cohorts to one, or to the shared sets alone.
  option("cohort", "Cohort", (row) => row.cohortShown),
  option("semester", "Semester", (row) => row.semester),
  option("course", "Course", (row) => row.course),
  option("type", "Type", (row) => row.typeLabel),
  option("teacher", "Teacher", (row) => row.teacherShown),
  option("status", "Status", (row) => row.statusShown),
  { id: "crn", displayName: "CRN", type: "text", accessor: (row) => row.crn, defaultWidth: 100 },
];

const KIND_LABEL: Record<LoadKind, string> = { CM: "CM", TD: "TD", TP: "TP", OTHER: "Other" };

/**
 * Teacher hours cohort by cohort, laid out as the department's teaching-load sheet: each
 * cohort's split, its CM/TD/TP hours and who teaches how many, over its courses and their
 * sections for the whole academic year. Department adds every cohort up.
 *
 * Searched and filtered as the other tables are — a section is kept or not — and every
 * figure on the page is then counted on the sections kept, so "what share of the year do
 * visiting professors teach in L2" is a chip, and the page says when it is narrowed.
 *
 * Narrowed to a program too, as the workbook's Maths and Physics tabs are: every tab then
 * counts only that program's courses. Its settings say which course counts as which, and
 * which tabs show — this browser's to choose, so a coordinator who looks after L1 and L2
 * alone need not step over the others.
 */
export function CohortLoads({
  cards,
  termIds,
  termLabel,
  teachers,
  programs = NO_COURSE_PROGRAMS,
  owed = NO_OWED,
  onOpenTeacher,
}: {
  cards: Card[];
  /** The semesters of the academic year, in order. */
  termIds: string[];
  termLabel: (termId: string) => string;
  teachers: ActiveTeacher[];
  /** The department's programmes and which courses count as each (Settings → Programmes). */
  programs?: CoursePrograms;
  /** Teaching owed by each full-timer, shown beside their year's hours on the department. */
  owed?: TeachingOwed;
  onOpenTeacher?: (teacher: TeacherRef) => void;
}) {
  const [chosen, setChosen] = usePageState<string>("teaching-loads:cohort", DEPARTMENT);
  const [filters, setFilters] = usePageState<FilterModel[]>("teaching-loads:filters", []);
  const [query, setQuery] = usePageState("teaching-loads:search", "");
  const [programSaid, setProgram] = useRemembered(TEACHING_LOADS_PROGRAM);
  // A program since taken away, or another department's, is every course.
  const program = programs.programmes.some((entry) => entry.code === programSaid) ? programSaid : "";
  const [hiddenSaid, setHiddenSaid] = useRemembered(TEACHING_LOADS_HIDDEN);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hidden = useMemo(() => new Set(hiddenSaid.split("\n").filter(Boolean)), [hiddenSaid]);

  // Every cohort of the year, whatever the program: the tabs one can choose from.
  const yearCohorts = useMemo(() => cohortLoads(cards, termIds, teachers, undefined, programs), [cards, termIds, teachers, programs]);
  const inProgram = useCallback((section: LoadSection) => !program || section.program === program, [program]);
  // The cohorts with something in the program, whatever is filtered, so a filter never takes a tab away.
  const everyCohort = useMemo(
    () => (program ? cohortLoads(cards, termIds, teachers, inProgram, programs) : yearCohorts),
    [program, cards, termIds, teachers, inProgram, programs, yearCohorts],
  );
  /*
   * All cohorts is every cohort's courses together (user, 25 Nov 2026), after the years. It
   * keeps the shared sets' own id, so a tab chosen or put away before stays so; the shared
   * sets alone are the Cohort filter's "All cohorts".
   */
  const years = everyCohort.filter((entry) => entry.cohortId !== ALL_COHORTS);
  // Beside a single year it would say the same twice.
  const offerEvery = everyCohort.length > 1 || everyCohort.some((entry) => entry.cohortId === ALL_COHORTS);
  const tabs = [
    ...(hidden.has(DEPARTMENT) ? [] : [{ id: DEPARTMENT, name: "Department" }]),
    ...years.filter((entry) => !hidden.has(entry.cohortId)).map((entry) => ({ id: entry.cohortId, name: entry.cohortName })),
    ...(offerEvery && !hidden.has(ALL_COHORTS) ? [{ id: ALL_COHORTS, name: "All cohorts" }] : []),
  ];
  // A tab put away, or with nothing in the program, gives way to the first one shown.
  const tab = tabs.some((entry) => entry.id === chosen) ? chosen : (tabs[0]?.id ?? DEPARTMENT);
  const every = tab === ALL_COHORTS;
  const cohort = useMemo(
    () => (every ? everyCohortLoad(everyCohort, ALL_COHORTS, "All cohorts", termIds) : (everyCohort.find((entry) => entry.cohortId === tab) ?? null)),
    [every, everyCohort, tab, termIds],
  );
  const cohortNames = useMemo(() => new Map(cards.map((card) => [card.cohortId, card.cohortName])), [cards]);

  const rows = useMemo<Row[]>(
    () =>
      loadSections(cards, termIds, teachers, programs)
        .filter(inProgram)
        .filter((section) => !cohort || every || section.cohortId === cohort.cohortId)
        .map((section) => ({
          ...section,
          cohortShown: cohortNames.get(section.cohortId) ?? "",
          semester: termLabel(section.termId),
          course: `${section.courseCode} · ${section.courseName}`,
          typeLabel: KIND_LABEL[section.kind],
          teacherShown: section.teacher || "Nobody yet",
          statusShown: bucketLabel(bucketOf(section)),
        })),
    [cards, termIds, teachers, programs, cohort, every, cohortNames, termLabel, inProgram],
  );
  const kept = useMemo(() => {
    const words = query.trim().toLowerCase();
    const searched = words
      ? rows.filter((row) =>
          [row.course, row.label, row.crn, row.teacherShown, row.semester].join(" ").toLowerCase().includes(words),
        )
      : rows;
    return new Set(applyFilters(searched, COLUMNS, filters).map((row) => row.key));
  }, [rows, query, filters]);
  const narrowed = Boolean(query.trim()) || filters.some((filter) => filter.values.length);
  const counted = useMemo(
    () => (narrowed ? cohortLoads(cards, termIds, teachers, (section) => kept.has(section.key), programs) : everyCohort),
    [narrowed, cards, termIds, teachers, kept, programs, everyCohort],
  );
  const shownCohort = !cohort
    ? null
    : every
      ? everyCohortLoad(counted, ALL_COHORTS, "All cohorts", termIds)
      : (counted.find((entry) => entry.cohortId === cohort.cohortId) ?? null);

  if (!yearCohorts.length) {
    return (
      <p className="rounded-lg border border-dashed border-[#b8c2cf] bg-white px-5 py-8 text-center text-sm text-[#475467]">
        Nothing is planned for this academic year yet. Groups &amp; CRNs is where sections are made.
      </p>
    );
  }
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold ${
      active ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#b8c2cf] bg-white text-[#344054] hover:border-[#1f4e79] hover:text-[#1f4e79]"
    }`;
  const clear = () => {
    setFilters([]);
    setQuery("");
  };
  const tabChoices = [
    { value: DEPARTMENT, label: "Department" },
    ...yearCohorts.filter((entry) => entry.cohortId !== ALL_COHORTS).map((entry) => ({ value: entry.cohortId, label: entry.cohortName })),
    ...(offerEvery ? [{ value: ALL_COHORTS, label: "All cohorts" }] : []),
  ];
  const programName = program ? programmeName(program, programs) : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Cohort" className="flex flex-wrap gap-1.5">
          {tabs.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={tab === entry.id} onClick={() => setChosen(entry.id)} className={chip(tab === entry.id)}>
              {entry.name}
            </button>
          ))}
        </div>
        {/* No programme with courses under it, nothing to narrow to: Settings → Programmes is where they are grouped. */}
        {programs.programmes.length ? (
          <div className="w-40">
            <SelectMenu
              label="Program"
              value={program}
              onChange={setProgram}
              align="start"
              options={[{ value: "", label: "All programs" }, ...programs.programmes.map((entry) => ({ value: entry.code, label: entry.name }))]}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b8c2cf] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:border-[#1f4e79] hover:text-[#1f4e79]"
        >
          <Settings2 size={14} aria-hidden="true" />
          Settings
        </button>
        <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
          <label className="relative block w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#475467]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search sections"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a course, CRN or teacher"
              className="w-full rounded-md border border-[#b8c2cf] bg-white py-1.5 pl-8 pr-2 text-sm placeholder:text-[#667085]"
            />
          </label>
          <span className="text-xs tabular-nums text-[#475467]">{`${kept.size} of ${rows.length} sections`}</span>
          {narrowed ? (
            <button type="button" onClick={clear} className="text-xs font-semibold text-[#1f4e79] underline">
              Every section
            </button>
          ) : null}
        </div>
      </div>
      {settingsOpen ? (
        <TeachingLoadsSettings
          open
          onClose={() => setSettingsOpen(false)}
          tabChoices={tabChoices}
          hidden={hidden}
          onHide={(next) => setHiddenSaid(next.join("\n"))}
        />
      ) : null}
      <TableFilterBar columns={COLUMNS} filters={filters} optionsFor={(column) => optionsFor(rows, column)} onChange={setFilters} />
      {programName ? <ProgrammeScopeNote programName={programName} /> : null}

      {!everyCohort.length ? (
        <p className="rounded-lg border border-dashed border-[#b8c2cf] bg-white px-5 py-8 text-center text-sm text-[#475467]">
          No {programName} course is planned for this academic year yet.{" "}
          <button type="button" onClick={() => setProgram("")} className="font-semibold text-[#1f4e79] underline">
            All programs
          </button>
        </p>
      ) : cohort && !shownCohort ? (
        <p className="rounded-lg border border-dashed border-[#b8c2cf] bg-white px-5 py-8 text-center text-sm text-[#475467]">
          No section of {cohort.cohortName} matches.{" "}
          <button type="button" onClick={clear} className="font-semibold text-[#1f4e79] underline">
            Every section
          </button>
        </p>
      ) : shownCohort ? (
        <CohortBlock
          cohort={shownCohort}
          every={every}
          termIds={termIds}
          termLabel={termLabel}
          narrowed={narrowed}
          programName={programName}
          onOpenTeacher={onOpenTeacher}
        />
      ) : (
        <DepartmentBlock
          cohorts={counted}
          termIds={termIds}
          termLabel={termLabel}
          narrowed={narrowed}
          programName={programName}
          // Beside a teacher's whole year only: a programme or a filter shows part of it.
          owed={narrowed || programName ? undefined : owed}
          canOpen={(cohortId) => cohortId !== ALL_COHORTS && tabs.some((entry) => entry.id === cohortId)}
          onChoose={setChosen}
          onOpenTeacher={onOpenTeacher}
        />
      )}
    </div>
  );
}

function Heading({ children, about }: { children: ReactNode; about?: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#171717]">
      {children}
      {about ? <InfoTip label="Where these hours come from">{about}</InfoTip> : null}
    </h3>
  );
}

const ABOUT = (
  <>
    The hours Groups &amp; CRNs plans for every section of the year, by the status of the teacher named on it. A
    teacher&apos;s status is set on their record; until it is, the portal&apos;s type is read as one. A search or filter
    counts only the sections it leaves.
  </>
);

const MOST_TEACHERS = 8;
/** The split beside the tiles and the teachers where both fit whole; stacked, split first, before that. */
const summaryGrid = "grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]";

/** The CM, TD, TP (and other, when there is any) hours, as tiles. */
function KindTiles({ kinds }: { kinds: Record<LoadKind, number> }) {
  const shown = LOAD_KINDS.filter((kind) => kind !== "OTHER" || kinds.OTHER > 0);
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
      {shown.map((kind) => (
        <div key={kind} className="rounded-lg border border-[#c9d2de] bg-[#eef2f7] px-3 py-2">
          <p className="text-xs font-semibold text-[#475467]">{KIND_LABEL[kind]}</p>
          <p className="text-lg font-semibold tabular-nums text-[#171717]">{hours(kinds[kind])}</p>
        </div>
      ))}
    </div>
  );
}

/** Who teaches how many of the hours, most first; on the department, which cohorts too. */
function TeacherList({
  title,
  teachers,
  owed,
  onOpenTeacher,
}: {
  title: string;
  teachers: (CohortLoad["teachers"][number] & { cohorts?: string[] })[];
  /** Each full-timer's teaching owed, for their year on the department; none elsewhere. */
  owed?: TeachingOwed;
  onOpenTeacher?: (teacher: TeacherRef) => void;
}) {
  const [all, setAll] = useState(false);
  const listed = all ? teachers : teachers.slice(0, MOST_TEACHERS);
  return (
    <section className={card}>
      <Heading>{title}</Heading>
      {teachers.length ? (
        <ul className="text-sm">
          {listed.map((teacher) => (
            <li key={teacher.teacherId || teacher.teacher} className="flex items-baseline justify-between gap-3 border-b border-[#dde3ea] py-1 last:border-b-0">
              <span className="min-w-0">
                <TeacherName teacherId={teacher.teacherId} name={teacher.teacher} onOpenTeacher={onOpenTeacher} />
                <StatusPill status={teacher.status} />
                {teacher.cohorts ? <span className="ml-2 text-xs text-[#475467]">{teacher.cohorts.join(" · ")}</span> : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {owed?.[teacher.teacherId] ? <OwedTag planned={teacher.hours} due={owed[teacher.teacherId]} /> : null}
                <span className="tabular-nums font-semibold text-[#171717]">{hours(teacher.hours)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#475467]">Nobody is named on these sections yet.</p>
      )}
      {teachers.length > MOST_TEACHERS ? (
        <button type="button" onClick={() => setAll((shown) => !shown)} className="mt-2 text-xs font-semibold text-[#1f4e79] hover:underline">
          {all ? "Show fewer" : `Show all ${teachers.length}`}
        </button>
      ) : null}
    </section>
  );
}

/**
 * What a full-timer owes of the year's service, after their hour reductions, and how far the
 * hours planned for them are from it: short in amber, over in blue, as owed in green.
 */
function OwedTag({ planned, due }: { planned: number; due: TeachingOwed[string] }) {
  const gap = Math.round((planned - due.owed) * 10) / 10;
  const tone = gap < 0 ? "bg-[#fdebc8] text-[#5c3305] ring-[#e3ab52]" : gap > 0 ? "bg-[#dbe8f6] text-[#1f3f63] ring-[#8fb2d8]" : "bg-[#d7f0e5] text-[#064e3b] ring-[#6cc5a0]";
  const said = gap < 0 ? `${hours(-gap)} short` : gap > 0 ? `${hours(gap)} over` : "as owed";
  return (
    <span
      title={`Owes ${hours(due.owed)} h this year: ${hours(due.service)} h of service less ${hours(due.reductions)} h of hour reductions (Budget → Hour reductions). ${hours(planned)} h are planned.`}
      className="whitespace-nowrap text-xs tabular-nums text-[#475467]"
    >
      owes {hours(due.owed)}
      <span className={`ml-1.5 inline-block rounded px-1.5 py-px font-semibold ring-1 ring-inset ${tone}`}>{said}</span>
    </span>
  );
}

/** A teacher's name, which opens their record where there is one to open. */
function TeacherName({ teacherId, name, onOpenTeacher }: { teacherId: string; name: string; onOpenTeacher?: (teacher: TeacherRef) => void }) {
  return onOpenTeacher && teacherId ? (
    <button type="button" onClick={() => onOpenTeacher({ id: teacherId, fullName: name })} className="text-left font-medium text-[#1f4e79] hover:underline">
      {name}
    </button>
  ) : (
    <span className="text-[#171717]">{name}</span>
  );
}

function DepartmentBlock({
  cohorts,
  termIds,
  termLabel,
  narrowed,
  programName,
  owed,
  canOpen,
  onChoose,
  onOpenTeacher,
}: {
  cohorts: CohortLoad[];
  termIds: string[];
  termLabel: (termId: string) => string;
  narrowed: boolean;
  /** "Maths" when the page is narrowed to a program; blank for every course. */
  programName: string;
  owed?: TeachingOwed;
  /** Whether a cohort has a tab to open: not when it is put away in Tabs. */
  canOpen: (cohortId: string) => boolean;
  onChoose: (cohortId: string) => void;
  onOpenTeacher?: (teacher: TeacherRef) => void;
}) {
  const split = useMemo(() => departmentSplit(cohorts, termIds), [cohorts, termIds]);
  const kinds = useMemo(() => departmentKinds(cohorts), [cohorts]);
  const teachers = useMemo(() => departmentTeachers(cohorts), [cohorts]);
  const shown = BUCKETS.filter(
    (bucket) => STAFF_STATUSES.some((entry) => entry.status === bucket) || cohorts.some((cohort) => cohort.split.year[bucket] > 0),
  );
  if (!cohorts.length) {
    return (
      <p className="rounded-lg border border-dashed border-[#b8c2cf] bg-white px-5 py-8 text-center text-sm text-[#475467]">
        No section matches.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className={summaryGrid}>
        <section className={card}>
          <Heading about={ABOUT}>
            {narrowed
              ? "Who teaches the hours of the sections shown"
              : `Who teaches the department’s ${programName ? `${programName} ` : ""}hours`}
          </Heading>
          <div className="overflow-x-auto">
            <SplitTable split={split} termIds={termIds} termLabel={termLabel} />
          </div>
        </section>
        <div className="space-y-4">
          <KindTiles kinds={kinds} />
          <TeacherList
            title={programName ? `Each teacher of ${programName} in the department` : "Each teacher in the department"}
            teachers={teachers}
            owed={owed}
            onOpenTeacher={onOpenTeacher}
          />
        </div>
      </div>
      <section className={card}>
        <Heading>{programName ? `${programName}, cohort by cohort, over the year` : "Cohort by cohort, over the year"}</Heading>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-[#344054]">
                <th className="border-b-2 border-[#b8c2cf] py-1.5 pr-3 text-left font-semibold">Cohort</th>
                <th className="border-b-2 border-[#b8c2cf] py-1.5 pl-4 text-right font-semibold">Hours</th>
                {shown.map((bucket) => (
                  <th key={bucket} className="border-b-2 border-[#b8c2cf] py-1.5 pl-4 text-right">
                    <Tag bucket={bucket} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => {
                const total = splitTotal(cohort.split.year);
                return (
                  <tr key={cohort.cohortId} className="hover:bg-[#f5f8fc]">
                    <td className={`${lineCell} pr-3`}>
                      {cohort.cohortId === ALL_COHORTS ? (
                        /*
                         * The sets every cohort shares, the languages: counted here once, in no
                         * year. The All cohorts tab is every cohort's courses, these among them.
                         */
                        <span
                          className="inline-flex items-center gap-1.5 font-semibold text-[#171717]"
                          title="The sets every cohort shares, such as the languages. The All cohorts tab lists them with every other course; its Cohort filter shows them alone."
                        >
                          {cohort.cohortName}
                          <span className="rounded-full bg-[#eef1f5] px-1.5 text-[11px] font-medium text-[#475467]">shared sets</span>
                        </span>
                      ) : canOpen(cohort.cohortId) ? (
                        <button type="button" onClick={() => onChoose(cohort.cohortId)} className="font-semibold text-[#1f4e79] hover:underline">
                          {cohort.cohortName}
                        </button>
                      ) : (
                        // Still counted in the department; its tab is only put away.
                        <span className="font-semibold text-[#171717]" title="Its tab is put away: tick it in Tabs to open it">
                          {cohort.cohortName}
                        </span>
                      )}
                    </td>
                    <td className={`${lineCell} pl-4 text-right font-semibold text-[#171717]`}>{hours(total)}</td>
                    {shown.map((bucket) => (
                      <td key={bucket} className={`${lineCell} whitespace-nowrap pl-4 text-right`}>
                        <HoursShare value={cohort.split.year[bucket]} total={total} bucket={bucket} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/*
 * The section table's cells. The header row sticks to the top of the table's own scroll
 * box, each course's line sticks under it while that course's sections scroll by — the
 * next course's line takes its place — and the first column sticks to the left, so a
 * long cohort reads as the sheet does without losing which course or column a number is.
 */
const head = "sticky top-0 z-20 h-9 whitespace-nowrap border-b-2 border-r border-[#b8c2cf] bg-[#eef2f7] px-3 text-xs font-semibold text-[#344054] last:border-r-0";
const courseCell = "sticky top-9 z-10 border-b border-r border-[#b8c2cf] bg-[#e4eaf2] px-3 py-1.5 font-semibold text-[#171717] last:border-r-0";
const cell = "border-b border-r border-[#dde3ea] px-3 py-1.5 group-hover:bg-[#f5f8fc] last:border-r-0";

function CohortBlock({
  cohort,
  every = false,
  termIds,
  termLabel,
  narrowed,
  programName,
  onOpenTeacher,
}: {
  cohort: CohortLoad;
  /** Every cohort's courses together, as All cohorts shows them: each course says whose it is. */
  every?: boolean;
  termIds: string[];
  termLabel: (termId: string) => string;
  narrowed: boolean;
  programName: string;
  onOpenTeacher?: (teacher: TeacherRef) => void;
}) {
  const whose = every ? "every cohort’s" : `${cohort.cohortName}’s`;
  const kinds = LOAD_KINDS.filter((kind) => kind !== "OTHER" || cohort.kinds.OTHER > 0);
  const teacherName = (teacherId: string, name: string) => (
    <TeacherName teacherId={teacherId} name={name} onOpenTeacher={onOpenTeacher} />
  );

  return (
    <div className="space-y-4">
      <div className={summaryGrid}>
        <section className={card}>
          <Heading about={ABOUT}>
            {narrowed
              ? "Who teaches the hours of the sections shown"
              : `Who teaches ${whose} ${programName ? `${programName} ` : ""}hours`}
          </Heading>
          <div className="overflow-x-auto">
            <SplitTable split={cohort.split} termIds={termIds} termLabel={termLabel} />
          </div>
        </section>
        <div className="space-y-4">
          <KindTiles kinds={cohort.kinds} />
          <TeacherList
            title={`Each teacher ${programName ? `of ${programName} ` : ""}in ${every ? "every cohort" : cohort.cohortName}`}
            teachers={cohort.teachers}
            onOpenTeacher={onOpenTeacher}
          />
        </div>
      </div>

      <div className="always-scrollbar max-h-[min(78vh,64rem)] overflow-auto overscroll-x-none rounded-lg border border-[#b8c2cf] bg-white">
        {cohort.semesters.map((semester) => (
          <table key={semester.termId} className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm tabular-nums">
            <thead>
              <tr>
                <th scope="col" className={`${head} left-0 z-30 text-left text-sm text-[#171717]`}>
                  {termLabel(semester.termId)}
                </th>
                <th scope="col" className={`${head} text-left`}>CRN</th>
                <th scope="col" className={`${head} text-left`}>Teacher</th>
                {kinds.map((kind) => (
                  <th key={kind} scope="col" className={`${head} text-right`}>
                    {KIND_LABEL[kind]}
                  </th>
                ))}
                <th scope="col" className={`${head} text-right`}>Students</th>
                <th scope="col" className={`${head} text-right`}>Total</th>
              </tr>
            </thead>
            {semester.courses.map((course) => {
              const byKind = (kind: LoadKind) =>
                course.sections.filter((section) => section.kind === kind).reduce((sum, section) => sum + section.hours, 0);
              const total = course.sections.reduce((sum, section) => sum + section.hours, 0);
              return (
                <tbody key={course.card.key}>
                  <tr>
                    <td colSpan={3} className={`${courseCell} left-0 z-[15]`}>
                      <span>{course.card.name || course.card.code}</span>
                      <span className="ml-2 font-normal text-[#475467]">{course.card.code}</span>
                      {every ? (
                        <span className="ml-2 inline-block rounded-full bg-[#e8eef6] px-2 text-xs font-semibold text-[#1f4e79]">
                          {course.card.cohortName}
                        </span>
                      ) : null}
                      {course.coefficient ? (
                        <span className="ml-2 inline-block rounded border border-[#8f9bab] bg-white px-1.5 text-xs font-semibold text-[#344054]">
                          Coeff. {course.coefficient}
                        </span>
                      ) : (
                        <span className="ml-2 text-xs font-normal text-[#667085]" title="Set on the course's record, from Active courses">
                          No coefficient
                        </span>
                      )}
                    </td>
                    {kinds.map((kind) => (
                      <td key={kind} className={`${courseCell} text-right`}>
                        {byKind(kind) ? hours(byKind(kind)) : ""}
                      </td>
                    ))}
                    <td className={courseCell} />
                    <td className={`${courseCell} text-right`}>{hours(total)}</td>
                  </tr>
                  {course.sections.map((section) => (
                    <tr key={section.key} className="group">
                      <td className={`${cell} sticky left-0 z-[5] bg-white pl-6 text-[#344054]`}>{section.label}</td>
                      <td className={`${cell} text-left text-[#344054]`}>{section.crn || <span className="text-[#667085]">–</span>}</td>
                      <td className={`${cell} text-left`}>
                        {section.teacher ? (
                          <>
                            {teacherName(section.teacherId, section.teacher)}
                            <StatusPill status={section.status} />
                          </>
                        ) : (
                          <span className="font-semibold text-[#a6292f]">Nobody yet</span>
                        )}
                      </td>
                      {kinds.map((kind) => (
                        <td key={kind} className={`${cell} text-right text-[#171717]`}>
                          {section.kind === kind && section.hours ? hours(section.hours) : ""}
                        </td>
                      ))}
                      <td className={`${cell} text-right text-[#344054]`}>{section.students || ""}</td>
                      <td className={`${cell} text-right font-semibold text-[#171717]`}>{hours(section.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        ))}
      </div>
    </div>
  );
}
