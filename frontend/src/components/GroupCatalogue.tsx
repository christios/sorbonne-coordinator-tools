import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { downloadAdmissionsList } from "@/services/admissionsExport";
import { type TermCrns, fetchTermCrns } from "@/services/portalLists";
import { FillBlock, type FillReport } from "@/components/FillBlock";
import { InfoHint } from "@/components/InfoHint";
import { WorkbookReview } from "@/components/WorkbookReview";
import { ScreenLoading } from "@/components/ScreenLoading";
import { type CrnVerdict, type GroupClash, fetchPublication } from "@/services/publication";
import { countsLine, summariseCatalogue } from "@/services/catalogueSummary";
import { clashName, clashesIn, describeClashWindow, unplacedIn, verdictFor } from "@/services/publicationView";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import { downloadWorkbook, prefixOf } from "@/services/workbookExport";
import {
  type WorkbookApplied,
  addCourse,
  addGroup,
  addScope,
  applyWorkbook,
  deleteGroup,
  deleteScope,
  fetchAssignments,
  fetchCatalogue,
  previewWorkbook,
  setGroupCrn,
  updateGroup,
  type CatalogueGroup,
  type CatalogueScope,
  type Cohort,
} from "@/services/studentDatabase";
import type { Operation, WorkbookPreview } from "@/services/workbookReview";

/**
 * The groups a cohort assigns students into, as a matrix per block: the block's courses
 * across the top, its groups down the side, a CRN in every cell. It is the Legend sheet
 * of the group-assignment workbooks, made editable — and it is the only place CRNs are
 * entered, because everywhere else a group stands for the bundle of CRNs it holds.
 *
 * A workbook fills it in one go — its Reference sheet the blocks and CRNs, its student tabs
 * who sits in which group — but only through a review: the upload writes nothing until each
 * difference has been ticked. After that the workbook is finished with, and the catalogue is
 * maintained here.
 */
export function GroupCatalogue({
  cohort,
  termId = "",
  onShowStudents,
}: {
  cohort: Cohort;
  termId?: string;
  /** Opens the Students table on exactly these ids, for the "nobody has placed them" warning. */
  onShowStudents?: (studentIds: string[]) => void;
}) {
  const client = useQueryClient();
  const catalogue = useQuery({
    queryKey: ["catalogue", cohort.id, termId],
    queryFn: () => fetchCatalogue(cohort.id, termId),
  });
  // What the timetable says about each CRN. Best effort: the catalogue is still editable
  // when the Student Hub cannot be reached, it just cannot be checked.
  const publication = useQuery({
    queryKey: ["publication", termId],
    queryFn: () => fetchPublication(termId),
    enabled: Boolean(termId),
    retry: false,
  });
  // What the registrar portal lists for this semester, once it is linked to a portal
  // term. A CRN the timetable has but the portal does not is a CRN nobody can register in.
  const portal = useQuery({
    queryKey: ["portal-crns", termId],
    queryFn: () => fetchTermCrns(termId),
    enabled: Boolean(termId),
    retry: false,
  });
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [applied, setApplied] = useState<(WorkbookApplied & { approved: number }) | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingList, setExportingList] = useState(false);
  const [pendingScope, setPendingScope] = useState<CatalogueScope | null>(null);
  const [filled, setFilled] = useState<FillReport | null>(null);
  // The programmes this browser has seen the registrar use, for a group to prefer one.
  const programs = useQuery({
    queryKey: ["fields-held", "MAJOR_CODE_DESC"],
    queryFn: async () => [...new Set(Object.values(await fieldHeld("MAJOR_CODE_DESC")))].sort(),
  });

  /*
   * The catalogue and what the platform makes of it, together.
   *
   * The "nobody has placed them" warning and the CRN ticks are both read from the
   * publication, not from the catalogue — so removing a group, adding a block or typing a
   * CRN changed the matrix and left the warning above it describing the semester as it was
   * a moment ago. It took a page refresh to catch up, which is the one thing a coordinator
   * should never have to think to do.
   */
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["catalogue", cohort.id, termId] });
    client.invalidateQueries({ queryKey: ["assignments", cohort.id] });
    client.invalidateQueries({ queryKey: ["students"] });
    client.invalidateQueries({ queryKey: ["publication"] });
  };

  // One workbook, both halves, and nothing written until it has been looked at.
  const check = useMutation({
    mutationFn: (file: File) => previewWorkbook(cohort.id, termId, file),
    onSuccess: (payload) => {
      setPreview(payload);
      setApplied(null);
    },
  });
  const apply = useMutation({
    mutationFn: ({ operations }: { operations: Operation[]; approved: number }) =>
      applyWorkbook(cohort.id, termId, operations),
    onSuccess: (result, variables) => {
      setApplied({ ...result, approved: variables.approved });
      setPreview(null);
      refresh();
    },
  });
  const createScope = useMutation({
    mutationFn: (code: string) => addScope(cohort.id, { code, termId }),
    onSuccess: refresh,
  });
  const removeScope = useMutation({ mutationFn: deleteScope, onSuccess: refresh });

  /*
   * How many names this browser holds, which the export note reports. Read rather than
   * computed: the names live in a drawer the browser answers for asynchronously.
   */
  const [heldNames, setHeldNames] = useState(0);
  useEffect(() => {
    let current = true;
    void namesHeld().then((held) => {
      if (current) setHeldNames(Object.keys(held).length);
    });
    return () => {
      current = false;
    };
  }, [catalogue.dataUpdatedAt]);

  /**
   * Write the semester back out as the workbook it came from.
   *
   * Assembled here rather than on the server because it carries names, and names live in
   * this browser only. Everything else it needs is already on screen.
   */
  const exportWorkbook = async () => {
    setExporting(true);
    try {
      const held = await namesHeld();
      // The registrar's word for what they are on, which the workbook has a column for.
      const programs = await fieldHeld("MAJOR_CODE_DESC");
      const placements = await fetchAssignments(cohort.id);
      const byScope = new Map(scopes.map((scope) => [scope.id, scope.code]));
      const labelOf = new Map(
        scopes.flatMap((scope) => scope.groups.map((group) => [group.id, group.label] as const)),
      );

      const students = Object.entries(placements)
        .map(([studentId, byScopeId]) => ({
          studentId,
          name: held[studentId] ?? "",
          program: programs[studentId] ?? "",
          groups: Object.fromEntries(
            Object.entries(byScopeId).flatMap(([scopeId, groupId]) => {
              const code = byScope.get(scopeId);
              const label = labelOf.get(groupId);
              return code && label ? [[code, label] as const] : [];
            }),
          ),
        }))
        .sort((left, right) => left.studentId.localeCompare(right.studentId));

      await downloadWorkbook(
        {
          cohortName: cohort.name,
          prefix: prefixOf(cohort.name),
          blocks: scopes.map((scope) => ({
            code: scope.code,
            name: scope.name,
            tab: scope.tab ?? "",
            groupColumn: scope.groupColumn ?? "",
            columnIndex: scope.columnIndex ?? 0,
            courses: scope.courses,
            groups: scope.groups,
          })),
          students,
        },
        `${cohort.name.replace(/[^A-Za-z0-9]+/g, "-")}-groups.xlsx`,
      );
    } finally {
      setExporting(false);
    }
  };

  /*
   * The admissions list: the same groups, flattened to one row per student and one CRN
   * per course. Names come from this browser, like the workbook's.
   */
  const exportAdmissions = async () => {
    setExportingList(true);
    try {
      const held = await namesHeld();
      const placements = await fetchAssignments(cohort.id);
      await downloadAdmissionsList(
        {
          prefix: prefixOf(cohort.name),
          scopes,
          students: Object.entries(placements).map(([studentId, groups]) => ({
            studentId,
            name: held[studentId] ?? "",
            groups,
          })),
        },
        `${cohort.name.replace(/[^A-Za-z0-9]+/g, "-")}-admissions.xlsx`,
      );
    } finally {
      setExportingList(false);
    }
  };

  if (catalogue.isLoading) return <ScreenLoading label="Loading the groups…" />;
  if (catalogue.error) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {(catalogue.error as Error).message}
      </p>
    );
  }

  const scopes = catalogue.data?.scopes ?? [];
  const error = check.error?.message ?? createScope.error?.message ?? removeScope.error?.message ?? null;

  if (preview) {
    return (
      <WorkbookReview
        preview={preview}
        busy={apply.isPending}
        error={apply.error?.message ?? null}
        onApply={(operations, approved) => apply.mutate({ operations, approved })}
        onCancel={() => setPreview(null)}
      />
    );
  }

  const counts = summariseCatalogue(scopes);

  return (
    <>
      <section className="rounded-lg border border-[#d9dee7] bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-sm text-[#667085]">
            {scopes.length
              ? countsLine(counts)
              : termId
                ? "No blocks yet — add one below, or fill them all from a workbook."
                : "Choose a semester to see its blocks."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label
              title={termId ? undefined : "Choose a semester first — a workbook fills one semester."}
              className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${
                termId
                  ? "cursor-pointer bg-[#1f4e79] text-white hover:bg-[#183f63]"
                  : "cursor-not-allowed bg-[#e4e8ef] text-[#98a2b3]"
              }`}
            >
              {check.isPending ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet size={16} aria-hidden="true" />
              )}
              {check.isPending ? "Reading…" : "Upload workbook"}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                disabled={!termId}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) check.mutate(file);
                }}
              />
            </label>
            <InfoHint label="What an uploaded workbook must contain" title="Upload workbook">
              <p>
                One file says both things: its <b>Reference</b> sheet is the blocks, their groups
                and a CRN for every course; its <b>student tabs</b> are who sits in which group.
              </p>
              <p>
                Nothing is written on upload. Every difference is shown and you tick the ones to
                keep — whatever you leave unticked stays exactly as it is.
              </p>
              <p>
                Only students this cohort holds can be placed. Any other id in the file is
                reported and skipped.
              </p>
              {termId ? null : <p>Choose a semester first — a workbook fills one semester.</p>}
            </InfoHint>

            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-[#e4e8ef] sm:block" />

            <button
              type="button"
              onClick={exportWorkbook}
              disabled={exporting || scopes.length === 0}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}
              {exporting ? "Building…" : "Export workbook"}
            </button>
            <InfoHint label="What the exported workbook contains" title="Export workbook">
              <p>
                The same workbook this page was filled from — same tabs, same columns, in the same
                order — ready to edit and upload again.
              </p>
              <p>
                It would carry {countsLine(counts)}.
              </p>
              <p>
                {heldNames
                  ? `Student names come from this browser's last portal pull, ${heldNames} held. They are kept nowhere else, which is why the file is built here rather than on the server.`
                  : "This browser is holding no student names, so the name column would come out blank. Sync a portal filter on the Students page first."}
              </p>
            </InfoHint>
            <button
              type="button"
              onClick={exportAdmissions}
              disabled={exportingList || scopes.length === 0}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
            >
              {exportingList ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}
              {exportingList ? "Building…" : "Admissions list"}
            </button>
            <InfoHint label="What the admissions list contains" title="Admissions list">
              <p>
                One flat sheet for admissions to register from: a row per student who sits in a group,
                and a CRN column per course of every block — blank where they are in no group for it.
              </p>
              <p>
                Derived from the same groups as the workbook and the Student Hub, so the three agree.
                Names come from this browser, like the workbook&apos;s.
              </p>
            </InfoHint>
          </div>
        </div>

        {applied ? (
          <div className="mt-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={16} aria-hidden="true" />
              {applied.approved} approved change(s) applied
            </p>
            <p className="mt-1 leading-6">
              {applied.groups} group(s), {applied.courses} course(s) and {applied.cells} CRN(s) written,
              and {applied.placements} student placement(s). Everything you left unticked is as it was.
            </p>
          </div>
        ) : null}
        {filled ? (
          <div className="mt-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={16} aria-hidden="true" />
              {filled.assigned} student{filled.assigned === 1 ? "" : "s"} placed in {filled.scopeCode}
            </p>
            {filled.unplaced ? (
              <p className="mt-1 leading-6">
                {filled.unplaced} could not be placed and still {filled.unplaced === 1 ? "sits" : "sit"} in no group.
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </section>

      <Unplaced
        report={publication.data ? unplacedIn(publication.data, cohort.id) : null}
        onShow={onShowStudents}
      />

      <Clashes clashes={publication.data ? clashesIn(publication.data, cohort.id) : []} onShow={onShowStudents} />

      <div className="mt-5 space-y-5">
        {scopes.map((scope) => (
          <ScopeMatrix
            validation={publication.data?.validation ?? {}}
            portal={portal.data?.portalTermCode ? portal.data : null}
            key={scope.id}
            scope={scope}
            cohort={cohort}
            clashes={publication.data ? clashesIn(publication.data, cohort.id) : null}
            programs={programs.data ?? []}
            onChanged={refresh}
            onFilled={(report) => {
              setFilled(report);
              refresh();
            }}
            onRemove={() => setPendingScope(scope)}
          />
        ))}
      </div>

      <section className="mt-5 rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-4">
        <AddRow
          label="Add a block"
          placeholder="TD, CM, Readiness…"
          busy={createScope.isPending}
          onAdd={(code) => createScope.mutate(code)}
        />
      </section>

      <ConfirmDialog
        open={pendingScope !== null}
        title="Remove this block?"
        description={
          pendingScope
            ? `${pendingScope.code} and its ${pendingScope.groups.length} groups will be removed, and any student sitting in one of them will need placing again.`
            : ""
        }
        confirmLabel="Remove block"
        onConfirm={() => {
          if (pendingScope) removeScope.mutate(pendingScope.id);
          setPendingScope(null);
        }}
        onClose={() => setPendingScope(null)}
      />
    </>
  );
}

/**
 * The students this cohort has not put in a block yet.
 *
 * It is the publish screen's blocker, said here instead — where the placing happens, while
 * there is still time to do something about it, rather than at the moment the semester is
 * supposed to be finished.
 */
function Unplaced({
  report,
  onShow,
}: {
  report: ReturnType<typeof unplacedIn> | null;
  onShow?: (studentIds: string[]) => void;
}) {
  if (!report || report.total === 0) return null;

  return (
    <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
      <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
      <span>
        <b className="tabular-nums">{report.total}</b> student{report.total === 1 ? "" : "s"} in this
        cohort {report.total === 1 ? "is" : "are"} in no group for{" "}
        {report.byBlock.map((entry) => `${entry.scopeCode} (${entry.count})`).join(", ")}. Publishing
        gives them a blank timetable.
      </span>
      {onShow ? (
        <button
          type="button"
          onClick={() => onShow(report.ids)}
          className="font-semibold text-[#1f4e79] underline"
        >
          Show them in Students
        </button>
      ) : null}
    </p>
  );
}

/**
 * Groups that meet at the same hour, so cannot share a student.
 *
 * The timetable knows when every CRN meets; the groups were built here; this is where the
 * two are held against each other. Said on this page, above the matrix, because it is a
 * constraint on placing — a fill must never put one student in both — and the moment to
 * learn it is while the blocks are being built, not when a student's week has two things
 * at Monday 08:30.
 */
function Clashes({ clashes, onShow }: { clashes: GroupClash[]; onShow?: (studentIds: string[]) => void }) {
  const [showingAll, setShowingAll] = useState(false);
  if (clashes.length === 0) return null;

  // Worst first, and only the worst by default: a semester where every Readiness group
  // overlaps every TD group is twenty-odd lines, and the ones with students in both are
  // the ones to act on.
  const shown = showingAll ? clashes : clashes.slice(0, CLASHES_SHOWN);

  return (
    <section className="mt-5 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
        {clashes.length === 1 ? "One pair of groups meets" : `${clashes.length} pairs of groups meet`} at the
        same hour, so cannot share a student.
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((clash) => (
          <li
            key={clash.groups.map((group) => group.id).join("|")}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <b>{clashName(clash)}</b>
            <span>{clash.windows.map(describeClashWindow).join("; ")}</span>
            <span className="text-[#a07a2a]">
              ·{" "}
              {clash.students.length
                ? `${clash.students.length} student${clash.students.length === 1 ? "" : "s"} in both`
                : "nobody in both yet"}
            </span>
            {onShow && clash.students.length ? (
              <button
                type="button"
                onClick={() => onShow(clash.students)}
                className="font-semibold text-[#1f4e79] underline"
              >
                Show them in Students
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {clashes.length > CLASHES_SHOWN ? (
        <button
          type="button"
          onClick={() => setShowingAll((current) => !current)}
          className="mt-1 font-semibold text-[#1f4e79] underline"
        >
          {showingAll ? "Show fewer" : `Show all ${clashes.length} pairs`}
        </button>
      ) : null}
    </section>
  );
}

const CLASHES_SHOWN = 5;

function ScopeMatrix({
  scope,
  cohort,
  clashes,
  programs,
  validation,
  portal,
  onChanged,
  onFilled,
  onRemove,
}: {
  scope: CatalogueScope;
  cohort: Cohort;
  /** The cohort's clashing pairs, or null while the timetable's word is not in. */
  clashes: GroupClash[] | null;
  /** The programmes a group may prefer, as this browser has seen the registrar spell them. */
  programs: string[];
  /** What the timetable says about each CRN, keyed "groupId|courseCode". */
  validation: Record<string, CrnVerdict>;
  /** What the portal lists for the linked term, or null when the semester is not linked. */
  portal: TermCrns | null;
  onChanged: () => void;
  onFilled: (report: FillReport) => void;
  onRemove: () => void;
}) {
  const [pendingGroup, setPendingGroup] = useState<CatalogueGroup | null>(null);
  const [filling, setFilling] = useState(false);

  const createGroup = useMutation({
    mutationFn: (label: string) => addGroup(scope.id, { label }),
    onSuccess: onChanged,
  });
  const createCourse = useMutation({
    mutationFn: (code: string) => addCourse(scope.id, { code }),
    onSuccess: onChanged,
  });
  const removeGroup = useMutation({ mutationFn: deleteGroup, onSuccess: onChanged });
  const prefer = useMutation({
    mutationFn: ({ group, program }: { group: CatalogueGroup; program: string }) =>
      updateGroup(group.id, { label: group.label, capacity: group.capacity, note: group.note, program }),
    onSuccess: onChanged,
  });
  const saveCell = useMutation({
    mutationFn: ({ groupId, courseId, crn }: { groupId: string; courseId: string; crn: string }) =>
      setGroupCrn(groupId, courseId, { crn }),
    onSuccess: onChanged,
  });

  const error =
    createGroup.error?.message ??
    createCourse.error?.message ??
    saveCell.error?.message ??
    prefer.error?.message ??
    null;

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#e4e8ef] px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="text-base font-semibold text-[#171717]">{scope.code}</h3>
          <p className="text-sm text-[#667085]">
            {scope.name || "block"} · {scope.groups.length} group{scope.groups.length === 1 ? "" : "s"} ·{" "}
            {scope.courses.length} course{scope.courses.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilling(true)}
            disabled={scope.groups.length === 0}
            title={scope.groups.length ? undefined : "Add a group first."}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
          >
            <Wand2 size={14} aria-hidden="true" /> Fill {scope.code}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
          >
            Remove block
          </button>
        </div>
      </header>

      {filling ? (
        <FillBlock
          open
          cohort={cohort}
          scope={scope}
          clashes={clashes}
          onClose={() => setFilling(false)}
          onFilled={(report) => {
            setFilling(false);
            onFilled(report);
          }}
        />
      ) : null}

      {error ? (
        <p role="alert" className="px-5 py-3 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Group</th>
              {scope.courses.map((course) => (
                <th key={course.id} scope="col" className="px-3 py-3 font-semibold">
                  {course.code}
                  <span className="mt-0.5 block text-[11px] font-normal normal-case text-[#98a2b3]">
                    {course.name}
                    {course.component ? ` · ${course.component}` : ""}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {scope.groups.map((group) => (
              <tr key={group.id} className="border-t border-[#eef1f5]">
                <td className="px-5 py-2">
                  <span className="font-semibold text-[#171717]">{group.label}</span>
                  <span className="mt-0.5 block text-xs text-[#667085]">
                    {group.capacity
                      ? `${group.assigned}/${group.capacity} seats`
                      : `${group.assigned} assigned`}
                    {group.note ? ` · ${group.note}` : ""}
                  </span>
                  <select
                    aria-label={`Programme ${scope.code} group ${group.label} prefers`}
                    value={group.program}
                    onChange={(event) => prefer.mutate({ group, program: event.target.value })}
                    className={`mt-1 block max-w-[11rem] rounded border bg-white px-1 py-0.5 text-xs ${
                      group.program ? "border-[#cfe3d4] text-[#2f6b3d]" : "border-transparent text-[#98a2b3]"
                    }`}
                  >
                    <option value="">Any programme</option>
                    {/* The value it holds stays choosable even when this browser has not seen it. */}
                    {[...new Set([group.program, ...programs].filter(Boolean))].map((program) => (
                      <option key={program} value={program}>
                        Prefers {program}
                      </option>
                    ))}
                  </select>
                </td>
                {scope.courses.map((course) => (
                  <td key={course.id} className="px-3 py-2">
                    <CrnCell
                      label={`CRN for ${scope.code} group ${group.label}, ${course.code}`}
                      crn={group.crns[course.id]?.crn ?? ""}
                      teacher={group.crns[course.id]?.teacher ?? ""}
                      verdict={verdictFor(validation, group.id, course.code)}
                      portal={portal ? (portal.crns[group.crns[course.id]?.crn ?? ""] ?? null) : undefined}
                      onSave={(crn) => saveCell.mutate({ groupId: group.id, courseId: course.id, crn })}
                    />
                  </td>
                ))}
                <td className="px-5 py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Remove group ${group.label}`}
                    onClick={() => setPendingGroup(group)}
                    className="rounded-md p-2 text-[#a6292f] hover:bg-[#fdf3f3]"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {scope.groups.length === 0 ? (
              <tr>
                <td colSpan={scope.courses.length + 2} className="px-5 py-6 text-sm text-[#667085]">
                  No groups yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-6 border-t border-[#eef1f5] px-5 py-3">
        <AddRow
          label="Add a group"
          placeholder="3, 1A, A1-G2…"
          busy={createGroup.isPending}
          onAdd={(label) => createGroup.mutate(label)}
        />
        <AddRow
          label="Add a course"
          placeholder="MATH001"
          busy={createCourse.isPending}
          onAdd={(code) => createCourse.mutate(code)}
        />
      </div>

      <ConfirmDialog
        open={pendingGroup !== null}
        title="Remove this group?"
        description={
          pendingGroup
            ? `Group ${pendingGroup.label} and its CRNs will be removed. ${
                pendingGroup.assigned
                  ? `${pendingGroup.assigned} student${pendingGroup.assigned === 1 ? "" : "s"} sitting in it will need placing again.`
                  : "Nobody is sitting in it."
              }`
            : ""
        }
        confirmLabel="Remove group"
        onConfirm={() => {
          if (pendingGroup) removeGroup.mutate(pendingGroup.id);
          setPendingGroup(null);
        }}
        onClose={() => setPendingGroup(null)}
      />
    </section>
  );
}

/**
 * One cell of the matrix.
 *
 * Controlled, deliberately. An uncontrolled input keeps whatever the DOM holds, so after
 * the catalogue refetches — or if focus lands here and leaves again — a blur would save
 * stale text, and an empty field would silently delete the CRN. Comparing the draft with
 * the stored value means a blur that changed nothing saves nothing.
 */
function CrnCell({
  label,
  crn,
  teacher,
  verdict,
  portal,
  onSave,
}: {
  label: string;
  crn: string;
  teacher: string;
  /** Undefined when the timetable could not be reached, which is not the same as wrong. */
  verdict?: CrnVerdict;
  /** The portal's row for this CRN; null when the portal lists no such CRN; undefined when unlinked. */
  portal?: TermCrns["crns"][string] | null;
  onSave: (crn: string) => void;
}) {
  const [draft, setDraft] = useState(crn);

  useEffect(() => setDraft(crn), [crn]);

  return (
    <>
      <input
        aria-label={label}
        value={draft}
        inputMode="numeric"
        placeholder="—"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (next === crn) return;
          onSave(next);
        }}
        className={`w-24 rounded-md border px-2 py-1.5 text-sm tabular-nums ${
          verdict && verdict.status !== "matched" && crn ? "border-[#e5b7b9] bg-[#fdf3f3]" : "border-[#cbd5e1]"
        }`}
      />
      <Verdict verdict={verdict} crn={crn} />
      {teacher ? <span className="mt-0.5 block text-[11px] text-[#98a2b3]">{teacher}</span> : null}
      {crn && portal === null ? (
        <span className="mt-0.5 block text-[11px] text-[#a6292f]">Not in the portal&apos;s list</span>
      ) : crn && portal && portal.teacherName && (!teacher || portal.teacherName !== teacher) ? (
        <span className="mt-0.5 block text-[11px] text-[#667085]" title="The teacher the portal lists for this CRN">
          Portal: {portal.teacherName}
        </span>
      ) : null}
    </>
  );
}

function AddRow({
  label,
  placeholder,
  busy,
  onAdd,
}: {
  label: string;
  placeholder: string;
  busy: boolean;
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setValue("");
      }}
    >
      <label className="text-sm font-semibold text-[#344054]">
        {label}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="mt-1 block w-44 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] disabled:opacity-50"
      >
        <Plus size={15} aria-hidden="true" /> Add
      </button>
    </form>
  );
}

/**
 * Whether the timetable agrees that this CRN exists, and is this course.
 *
 * A tick is worth little on its own; what earns its place is the two ways it can fail. A
 * CRN the timetable has never held enrols nobody — the group looks filled and teaches
 * nothing. A CRN that exists but belongs to another course is the one nobody catches by
 * reading: it is a real section, of the wrong subject.
 *
 * Nothing is shown when the timetable could not be reached. Silence is not a verdict, and
 * a red mark that only means "we could not ask" would be worse than no mark at all.
 */
function Verdict({ verdict, crn }: { verdict?: CrnVerdict; crn: string }) {
  if (!crn || !verdict) return null;

  if (verdict.status === "matched") {
    const section = verdict.section;
    return (
      <span
        title={section ? `${section.code} · ${section.groupLabel || section.kind}` : "In the timetable"}
        className="ml-1.5 inline-flex items-center align-middle text-[#2f6b3d]"
      >
        <Check size={15} aria-label="In the timetable" />
      </span>
    );
  }

  return (
    <span
      title={verdict.detail}
      className="ml-1.5 inline-flex items-center align-middle text-[#a6292f]"
    >
      <AlertTriangle size={15} aria-label={verdict.detail} />
    </span>
  );
}
