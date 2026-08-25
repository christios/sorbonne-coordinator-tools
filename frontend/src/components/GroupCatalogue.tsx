import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkbookReview } from "@/components/WorkbookReview";
import { ScreenLoading } from "@/components/ScreenLoading";
import { type CrnVerdict, fetchPublication } from "@/services/publication";
import { verdictFor } from "@/services/publicationView";
import { namesHeld } from "@/services/rosterStore";
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
export function GroupCatalogue({ cohort, termId = "" }: { cohort: Cohort; termId?: string }) {
  const client = useQueryClient();
  const catalogue = useQuery({
    queryKey: ["catalogue", cohort.id, termId],
    queryFn: () => fetchCatalogue(cohort.id, termId),
  });
  // What the timetable says about each CRN. Best effort: the catalogue is still editable
  // when the student platform cannot be reached, it just cannot be checked.
  const publication = useQuery({
    queryKey: ["publication", termId],
    queryFn: () => fetchPublication(termId),
    enabled: Boolean(termId),
    retry: false,
  });
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [applied, setApplied] = useState<(WorkbookApplied & { approved: number }) | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pendingScope, setPendingScope] = useState<CatalogueScope | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ["catalogue", cohort.id, termId] });

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
      client.invalidateQueries({ queryKey: ["publication", termId] });
      refresh();
    },
  });
  const createScope = useMutation({
    mutationFn: (code: string) => addScope(cohort.id, { code, termId }),
    onSuccess: refresh,
  });
  const removeScope = useMutation({ mutationFn: deleteScope, onSuccess: refresh });

  /**
   * Write the semester back out as the workbook it came from.
   *
   * Assembled here rather than on the server because it carries names, and names live in
   * this browser only. Everything else it needs is already on screen.
   */
  const exportWorkbook = async () => {
    setExporting(true);
    try {
      const held = namesHeld();
      const placements = await fetchAssignments(cohort.id);
      const byScope = new Map(scopes.map((scope) => [scope.id, scope.code]));
      const labelOf = new Map(
        scopes.flatMap((scope) => scope.groups.map((group) => [group.id, group.label] as const)),
      );

      const students = Object.entries(placements)
        .map(([studentId, byScopeId]) => ({
          studentId,
          name: held[studentId] ?? "",
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

  return (
    <>
      <section className="rounded-lg border border-[#d9dee7] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-[#171717]">Fill this from a workbook</h3>
            <p className="mt-1 text-sm leading-6 text-[#667085]">
              One file says both things: its Reference sheet is the blocks, groups and CRNs, and its
              student tabs are who sits in which group. Nothing is written on upload — you are shown
              what it would change and approve it row by row.
              {termId ? "" : " Choose a semester first."}
            </p>
          </div>
          <label
            className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${
              termId
                ? "cursor-pointer bg-[#1f4e79] text-white hover:bg-[#183f63]"
                : "cursor-not-allowed bg-[#e4e8ef] text-[#98a2b3]"
            }`}
          >
            {check.isPending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload size={16} aria-hidden="true" />
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
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[#eef1f5] pt-4">
          <div>
            <h3 className="text-base font-semibold text-[#171717]">Take it back out</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#667085]">
              Download this semester as the same workbook, ready to edit and upload again. Student
              names come from this browser&rsquo;s last portal pull, because they are held nowhere else.
            </p>
          </div>
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
        </div>

        {applied ? (
          <div className="mt-4 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
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
        {error ? (
          <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </section>

      <div className="mt-5 space-y-5">
        {scopes.map((scope) => (
          <ScopeMatrix
            validation={publication.data?.validation ?? {}}
            key={scope.id}
            scope={scope}
            onChanged={refresh}
            onRemove={() => setPendingScope(scope)}
          />
        ))}
      </div>

      <AddRow
        label="Add a block"
        placeholder="TD, CM, Readiness…"
        busy={createScope.isPending}
        onAdd={(code) => createScope.mutate(code)}
      />

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

function ScopeMatrix({
  scope,
  validation,
  onChanged,
  onRemove,
}: {
  scope: CatalogueScope;
  /** What the timetable says about each CRN, keyed "groupId|courseCode". */
  validation: Record<string, CrnVerdict>;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [pendingGroup, setPendingGroup] = useState<CatalogueGroup | null>(null);

  const createGroup = useMutation({
    mutationFn: (label: string) => addGroup(scope.id, { label }),
    onSuccess: onChanged,
  });
  const createCourse = useMutation({
    mutationFn: (code: string) => addCourse(scope.id, { code }),
    onSuccess: onChanged,
  });
  const removeGroup = useMutation({ mutationFn: deleteGroup, onSuccess: onChanged });
  const saveCell = useMutation({
    mutationFn: ({ groupId, courseId, crn }: { groupId: string; courseId: string; crn: string }) =>
      setGroupCrn(groupId, courseId, { crn }),
    onSuccess: onChanged,
  });

  const error =
    createGroup.error?.message ?? createCourse.error?.message ?? saveCell.error?.message ?? null;

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
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
        >
          Remove block
        </button>
      </header>

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
                </td>
                {scope.courses.map((course) => (
                  <td key={course.id} className="px-3 py-2">
                    <CrnCell
                      label={`CRN for ${scope.code} group ${group.label}, ${course.code}`}
                      crn={group.crns[course.id]?.crn ?? ""}
                      teacher={group.crns[course.id]?.teacher ?? ""}
                      verdict={verdictFor(validation, group.id, course.code)}
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
  onSave,
}: {
  label: string;
  crn: string;
  teacher: string;
  /** Undefined when the timetable could not be reached, which is not the same as wrong. */
  verdict?: CrnVerdict;
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
      className="mt-4 flex items-end gap-2"
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
