import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { downloadAdmissionsList } from "@/services/admissionsExport";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import { type Cohort, fetchAssignments, fetchCatalogue, previewWorkbook } from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";
import { downloadWorkbook, prefixOf } from "@/services/workbookExport";
import type { WorkbookPreview } from "@/services/workbookReview";

/**
 * The files: the group workbook in and out, and the admissions list out.
 *
 * All three are one cohort's, for one semester, so the two are chosen here. The upload
 * writes nothing — it hands back what the workbook would change, and the page shows
 * that for review. Names come from this browser, which is why the files are built here.
 */
export function WorkbookTools({
  open,
  cohorts,
  terms,
  onClose,
  onPreview,
}: {
  open: boolean;
  cohorts: Cohort[];
  terms: TimetableTerm[];
  onClose: () => void;
  onPreview: (preview: WorkbookPreview, cohort: Cohort, termId: string) => void;
}) {
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  useEffect(() => {
    if (!cohortId && cohorts[0]) setCohortId(cohorts[0].id);
    if (!termId && terms[0]) setTermId(terms[0].id);
  }, [cohorts, terms, cohortId, termId]);
  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  const catalogue = useQuery({ queryKey: ["catalogue", cohortId, termId], queryFn: () => fetchCatalogue(cohortId, termId), enabled: open && Boolean(cohortId && termId) });
  const scopes = catalogue.data?.scopes ?? [];
  const [exporting, setExporting] = useState<"" | "workbook" | "list">("");
  const [heldNames, setHeldNames] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void namesHeld().then((held) => live && setHeldNames(Object.keys(held).length));
    return () => {
      live = false;
    };
  }, [open]);

  const check = useMutation({
    mutationFn: (file: File) => previewWorkbook(cohortId, termId, file),
    onSuccess: (preview) => cohort && onPreview(preview, cohort, termId),
  });

  const exportWorkbook = async () => {
    if (!cohort) return;
    setExporting("workbook");
    try {
      const held = await namesHeld();
      const programs = await fieldHeld("MAJOR_CODE_DESC");
      const placements = await fetchAssignments(cohort.id);
      const byScope = new Map(scopes.map((scope) => [scope.id, scope.code]));
      const labelOf = new Map(scopes.flatMap((scope) => scope.groups.map((group) => [group.id, group.label] as const)));
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
          blocks: scopes.map((scope) => ({ code: scope.code, name: scope.name, tab: scope.tab ?? "", groupColumn: scope.groupColumn ?? "", columnIndex: scope.columnIndex ?? 0, courses: scope.courses, groups: scope.groups })),
          students,
        },
        `${cohort.name.replace(/[^A-Za-z0-9]+/g, "-")}-groups.xlsx`,
      );
    } finally {
      setExporting("");
    }
  };

  const exportAdmissions = async () => {
    if (!cohort) return;
    setExporting("list");
    try {
      const held = await namesHeld();
      const placements = await fetchAssignments(cohort.id);
      await downloadAdmissionsList(
        { prefix: prefixOf(cohort.name), scopes, students: Object.entries(placements).map(([studentId, groups]) => ({ studentId, name: held[studentId] ?? "", groups })) },
        `${cohort.name.replace(/[^A-Za-z0-9]+/g, "-")}-admissions.xlsx`,
      );
    } finally {
      setExporting("");
    }
  };

  const ready = Boolean(cohort && termId);
  const button = "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50";

  return (
    <Modal open={open} title="Workbook and lists" description="One cohort, one semester: the group workbook in and out, and the admissions list out." onClose={onClose}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SelectMenu label="Cohort" value={cohortId} onChange={setCohortId} options={cohorts.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
        <SelectMenu label="Semester" value={termId} onChange={setTermId} placeholder="Choose a semester" options={terms.map((term) => ({ value: term.id, label: term.name }))} />
      </div>
      <p className="mb-3 text-xs text-[#98a2b3]">
        {ready ? `${scopes.length} group set${scopes.length === 1 ? "" : "s"} in this semester.` : "Choose a semester first — a workbook fills one semester."}{" "}
        {heldNames ? `Student names come from this browser's last portal pull, ${heldNames} held.` : "This browser holds no student names, so name columns come out blank."}
      </p>
      {check.error ? <p role="alert" className="mb-3 text-sm text-[#a6292f]">{(check.error as Error).message}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${ready ? "cursor-pointer bg-[#1f4e79] text-white hover:bg-[#183f63]" : "cursor-not-allowed bg-[#e4e8ef] text-[#98a2b3]"} inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold`}>
          {check.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={16} aria-hidden="true" />}
          {check.isPending ? "Reading…" : "Upload workbook"}
          <input
            type="file"
            accept=".xlsx"
            className="sr-only"
            disabled={!ready}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) check.mutate(file);
            }}
          />
        </label>
        <InfoHint label="What an uploaded workbook must contain" title="Upload workbook">
          <p>One file says both things: its <b>Reference</b> sheet is the blocks, their groups and a CRN for every course; its <b>student tabs</b> are who sits in which group.</p>
          <p>Nothing is written on upload. Every difference is shown and you tick the ones to keep.</p>
        </InfoHint>
        <button type="button" onClick={exportWorkbook} disabled={!ready || exporting !== "" || scopes.length === 0} className={button}>
          {exporting === "workbook" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting === "workbook" ? "Building…" : "Export workbook"}
        </button>
        <button type="button" onClick={exportAdmissions} disabled={!ready || exporting !== "" || scopes.length === 0} className={button}>
          {exporting === "list" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting === "list" ? "Building…" : "Admissions list"}
        </button>
      </div>
    </Modal>
  );
}
