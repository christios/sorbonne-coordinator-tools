import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { downloadAdmissionsList } from "@/services/admissionsExport";
import { fetchActiveCourses, fetchActiveTeachers } from "@/services/portalLists";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import { type Cohort, fetchAssignments, fetchCatalogue } from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";
import { downloadWorkbook, prefixOf, shortYear } from "@/services/workbookExport";

/**
 * The files: the group workbook out, and the admissions list out.
 *
 * Both are one cohort's, for one semester, so the two are chosen here. Names come from
 * this browser, which is why the files are built here.
 *
 * Upload is off for now. It matched a workbook's blocks to the semester's by their code,
 * and created what it could not match — so a set renamed since the file was written came
 * back as a second set with the students re-placed into it, silently. Reading it back in
 * waits until it matches on something a rename cannot break. The route, the diff and the
 * review screen are untouched; only the way in is gone.
 */
export function WorkbookTools({
  open,
  cohorts,
  terms,
  onClose,
}: {
  open: boolean;
  cohorts: Cohort[];
  terms: TimetableTerm[];
  onClose: () => void;
}) {
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  useEffect(() => {
    if (!cohortId && cohorts[0]) setCohortId(cohorts[0].id);
    if (!termId && terms[0]) setTermId(terms[0].id);
  }, [cohorts, terms, cohortId, termId]);
  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  const catalogue = useQuery({ queryKey: ["catalogue", cohortId, termId], queryFn: () => fetchCatalogue(cohortId, termId), enabled: open && Boolean(cohortId && termId) });
  // The UE codes: the workbook keys its columns on the Sorbonne unit, and only the
  // department's course list knows which unit a registrar's course code stands for.
  const active = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses, enabled: open });
  const ueOf = (courseCode: string) =>
    (active.data ?? []).find((course) => course.courseCode.toUpperCase() === courseCode.toUpperCase())?.ue ?? "";
  // Who is teaching: the Active teacher chosen for the section, else the name its row carried.
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers, enabled: open });
  const teacherOf = (section: { teacher: string; teacherId?: string }) =>
    (section.teacherId ? (teachers.data ?? []).find((teacher) => teacher.id === section.teacherId)?.fullName : "") ||
    section.teacher;
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
          ueOf,
          teacherOf,
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
        { prefix: prefixOf(cohort.name), year: shortYear(cohort.term), scopes, students: Object.entries(placements).map(([studentId, groups]) => ({ studentId, name: held[studentId] ?? "", groups })) },
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
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportWorkbook} disabled={!ready || exporting !== "" || scopes.length === 0} className={button}>
          {exporting === "workbook" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting === "workbook" ? "Building…" : "Export workbook"}
        </button>
        <button type="button" onClick={exportAdmissions} disabled={!ready || exporting !== "" || scopes.length === 0} className={button}>
          {exporting === "list" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting === "list" ? "Building…" : "Admissions list"}
        </button>
      </div>
      <p className="mt-4 border-t border-[#eef1f5] pt-3 text-xs text-[#98a2b3]">
        Reading a workbook back in is off for now. It matched a file&apos;s sets to the semester&apos;s by their code and
        made a new one where it could not match, so a set renamed since the file was written came back as a second set
        with the students moved into it. The schema is edited on the Group schema page instead.
      </p>
    </Modal>
  );
}
