import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenLoading } from "@/components/ScreenLoading";
import { type CrnVerdict, fetchPublication } from "@/services/publication";
import { verdictFor } from "@/services/publicationView";
import {
  addCourse,
  addGroup,
  addScope,
  deleteGroup,
  deleteScope,
  fetchCatalogue,
  importReferenceWorkbook,
  setGroupCrn,
  type CatalogueGroup,
  type CatalogueScope,
  type Cohort,
  type ImportReport,
} from "@/services/studentDatabase";

/**
 * The groups a cohort assigns students into, as a matrix per block: the block's courses
 * across the top, its groups down the side, a CRN in every cell. It is the Legend sheet
 * of the group-assignment workbooks, made editable — and it is the only place CRNs are
 * entered, because everywhere else a group stands for the bundle of CRNs it holds.
 *
 * A workbook's Reference sheet fills it in one go; after that the workbook is finished
 * with, and the catalogue is maintained here.
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
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pendingScope, setPendingScope] = useState<CatalogueScope | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ["catalogue", cohort.id, termId] });

  const importWorkbook = useMutation({
    mutationFn: (file: File) => importReferenceWorkbook(cohort.id, file),
    onSuccess: (result) => {
      setReport(result);
      refresh();
    },
  });
  const createScope = useMutation({
    mutationFn: (code: string) => addScope(cohort.id, { code }),
    onSuccess: refresh,
  });
  const removeScope = useMutation({ mutationFn: deleteScope, onSuccess: refresh });

  if (catalogue.isLoading) return <ScreenLoading label="Loading the groups…" />;
  if (catalogue.error) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {(catalogue.error as Error).message}
      </p>
    );
  }

  const scopes = catalogue.data?.scopes ?? [];
  const error =
    importWorkbook.error?.message ?? createScope.error?.message ?? removeScope.error?.message ?? null;

  return (
    <>
      <section className="rounded-lg border border-[#d9dee7] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-[#171717]">Fill this from a workbook</h3>
            <p className="mt-1 text-sm leading-6 text-[#667085]">
              Upload a group-assignment workbook and its Reference sheet becomes the blocks, groups
              and CRNs below. Re-uploading a corrected workbook updates the CRNs in place and leaves
              anything added here alone.
            </p>
          </div>
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]">
            {importWorkbook.isPending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload size={16} aria-hidden="true" />
            )}
            {importWorkbook.isPending ? "Reading…" : "Upload workbook"}
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) importWorkbook.mutate(file);
              }}
            />
          </label>
        </div>

        {report ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>
              {report.filename} · {report.sheet}: {report.read.scopes} block
              {report.read.scopes === 1 ? "" : "s"}, {report.read.groups} groups, {report.read.crns} CRNs.
              Added {report.added.scopes} blocks and {report.added.groups} groups.
            </span>
          </p>
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
