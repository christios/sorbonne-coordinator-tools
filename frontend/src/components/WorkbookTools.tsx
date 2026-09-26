import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { downloadAdmissionsList } from "@/services/admissionsExport";
import { downloadHandout, handoutName } from "@/services/studentHandout";
import { fetchActiveCourses, fetchActiveTeachers } from "@/services/portalLists";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import { type Cohort, fetchAssignmentMajors, fetchAssignments, fetchCatalogue, fetchMemberIds } from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";
import type { Card } from "@/services/courseCards";
import { downloadTimetableWorkbook, requestSheets, sheetTitle, semesterLabel } from "@/services/timetableExport";
import { downloadWorkbook, labelIn, prefixOf, readingsFor, shortYear } from "@/services/workbookExport";

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
/**
 * Where this cohort's own students are placed — and nobody else's.
 *
 * An assignment is filed under the cohort that owns the SET, not the cohort of the student,
 * so a set open to every cohort files every language student in the department under
 * whichever cohort happens to hold that set. All three exports read the placements, and all
 * three used to hand out a workbook, an admissions list and a student handout naming
 * seventy-eight people where Foundation Year has one to name.
 *
 * The records say who is in a cohort. The placements say where they sit.
 */
async function placementsOfMembers(cohortId: string): Promise<Record<string, Record<string, string>>> {
  const [placements, members] = await Promise.all([fetchAssignments(cohortId), fetchMemberIds(cohortId)]);
  return Object.fromEntries(Object.entries(placements).filter(([studentId]) => members.has(studentId)));
}

export function WorkbookTools({
  open,
  cohorts,
  terms,
  cards = [],
  teacherName = () => "",
  onClose,
}: {
  open: boolean;
  cohorts: Cohort[];
  terms: TimetableTerm[];
  /** Every cohort's course cards, which the timetable is built from. */
  cards?: Card[];
  /** An Active teacher's name, by id. */
  teacherName?: (teacherId: string) => string;
  onClose: () => void;
}) {
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  useEffect(() => {
    if (!cohortId && cohorts[0]) setCohortId(cohorts[0].id);
    if (!termId && terms[0]) setTermId(terms[0].id);
  }, [cohorts, terms, cohortId, termId]);
  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  const catalogue = useQuery({ queryKey: ["catalogue", cohortId, termId, "own-only"], queryFn: () => fetchCatalogue(cohortId, termId, true), enabled: open && Boolean(cohortId && termId) });
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
  const [exporting, setExporting] = useState<"" | "workbook" | "list" | "handout" | "timetable">("");
  // The timetable is the one file here that can be every cohort's at once.
  const [everyCohort, setEveryCohort] = useState(false);
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
      const placements = await placementsOfMembers(cohort.id);
      // Which half each placement took, where a group is written as its halves.
      const majors = await fetchAssignmentMajors(cohort.id);
      const byScope = new Map(scopes.map((scope) => [scope.id, scope]));
      const students = Object.entries(placements)
        .map(([studentId, byScopeId]) => ({
          studentId,
          name: held[studentId] ?? "",
          program: programs[studentId] ?? "",
          groups: Object.fromEntries(
            Object.entries(byScopeId).flatMap(([scopeId, groupId]) => {
              const scope = byScope.get(scopeId);
              const group = scope?.groups.find((candidate) => candidate.id === groupId);
              return scope && group ? [[scope.code, labelIn(group, scope, majors[studentId]?.[scopeId] ?? "")] as const] : [];
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
            groups: scope.groups.map((group) => ({ ...group, readings: readingsFor(group, scope) })),
          })),
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
      const placements = await placementsOfMembers(cohort.id);
      // Which major each placement took, so a student reads their major's own cells.
      const majors = await fetchAssignmentMajors(cohort.id);
      await downloadAdmissionsList(
        {
          prefix: prefixOf(cohort.name),
          year: shortYear(cohort.term),
          scopes,
          students: Object.entries(placements).map(([studentId, groups]) => ({ studentId, name: held[studentId] ?? "", groups, majors: majors[studentId] ?? {} })),
        },
        `${cohort.name.replace(/[^A-Za-z0-9]+/g, "-")}-admissions.xlsx`,
      );
    } finally {
      setExporting("");
    }
  };

  /*
   * The timetable: the workbook the timetabler gets — a sheet per cohort, the CRN table,
   * the teacher hours. It lived on every course card as "Timetable request", where it read
   * as that course's, and could only ever be the whole semester's. Here it is the chosen
   * cohort's, or every cohort's, for the chosen semester.
   */
  const termName = terms.find((candidate) => candidate.id === termId)?.name ?? "";
  const timetableCards = cards.filter(
    (card) => card.termId === termId && (everyCohort || card.cohortId === cohortId),
  );
  const exportTimetable = async () => {
    setExporting("timetable");
    try {
      const sheets = requestSheets(
        timetableCards,
        termId,
        termName,
        // The Degree column: the cohort's majors as the portal codes them, else its name.
        (id) => {
          const held = cohorts.find((candidate) => candidate.id === id);
          return held?.majors.join(" / ") || held?.name || "";
        },
        teacherName,
        // The sheet's own name, which each cohort answers for itself.
        (id) => cohorts.find((candidate) => candidate.id === id) ?? { name: "" },
      );
      // One workbook a year, as the department's own file is named; a cohort's says whose.
      const year = shortYear((everyCohort ? cohorts.find((candidate) => candidate.term) : cohort)?.term ?? "");
      const whose = everyCohort || !cohort ? "" : `-${cohort.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
      await downloadTimetableWorkbook(sheets, `Time-Tables-${year || "request"}${whose}.xlsx`, year);
    } finally {
      setExporting("");
    }
  };

  /**
   * The file the students get, which is the only one of the three they will ever see.
   *
   * Their own names and programmes come from this browser's roster, as everything with a
   * name in it does; the groups and the CRNs come from the catalogue on screen.
   */
  const exportHandout = async () => {
    if (!cohort) return;
    setExporting("handout");
    try {
      const held = await namesHeld();
      const programs = await fieldHeld("MAJOR_CODE_DESC");
      const family = await fieldHeld("LAST_NAME");
      const first = await fieldHeld("FIRST_NAME");
      const placements = await placementsOfMembers(cohort.id);
      // Which half each placement took, so each student reads their own major's lectures.
      const majors = await fetchAssignmentMajors(cohort.id);
      const labelOf = new Map(scopes.flatMap((scope) => scope.groups.map((group) => [group.id, group.label] as const)));
      const students = Object.entries(placements).map(([studentId, byScopeId]) => ({
        majors: majors[studentId] ?? {},
        studentId,
        // The registrar's own split where this browser has it, and the whole name where
        // it does not — the sheet promises the list is alphabetical by family name, so
        // something has to stand in that column.
        family: family[studentId] || held[studentId] || studentId,
        first: first[studentId] || "",
        programme: programs[studentId] ?? "",
        groups: Object.fromEntries(
          Object.entries(byScopeId).flatMap(([scopeId, groupId]) => {
            const label = labelOf.get(groupId);
            return label ? [[scopeId, label] as const] : [];
          }),
        ),
      }));
      const semester = semesterLabel(terms.find((term) => term.id === termId)?.name ?? "");
      await downloadHandout(
        { cohortName: cohort.name, semester, year: cohort.term, scopes, students, teacherOf },
        handoutName(cohort.workbookTab || prefixOf(cohort.name), cohort.term, sheetTitle(cohort, semester)),
      );
    } finally {
      setExporting("");
    }
  };

  const ready = Boolean(cohort && termId);
  const button = "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50";

  return (
    <Modal open={open} title="Workbook and lists" description="One cohort, one semester: the group workbook, the admissions list, the student handout and the timetable." onClose={onClose}>
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
        <button type="button" onClick={exportHandout} disabled={!ready || exporting !== "" || scopes.length === 0} className={button}>
          {exporting === "handout" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting === "handout" ? "Building…" : "Student handout"}
        </button>
      </div>
      {/*
        * The timetable on a line of its own, because it is the one file that can be more
        * than the chosen cohort's: the choice beside it says whose it is.
        */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportTimetable} disabled={!termId || exporting !== "" || timetableCards.length === 0} className={button}>
          {exporting === "timetable" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {exporting === "timetable" ? "Building…" : "Timetable"}
        </button>
        <div role="radiogroup" aria-label="Whose timetable" className="inline-flex rounded-md border border-[#b7bec8] bg-white p-0.5 text-xs font-semibold">
          {[
            { every: false, label: cohort?.name ?? "This cohort" },
            { every: true, label: "All cohorts" },
          ].map(({ every, label }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={everyCohort === every}
              onClick={() => setEveryCohort(every)}
              className={`rounded px-2.5 py-1.5 ${everyCohort === every ? "bg-[#1f4e79] text-white" : "text-[#667085] hover:bg-[#f5f7fa]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[#98a2b3]">
          {termId
            ? `${timetableCards.length} course${timetableCards.length === 1 ? "" : "s"} across ${new Set(timetableCards.map((card) => card.cohortId)).size} cohort(s).`
            : ""}
        </span>
      </div>
      <p className="mt-4 border-t border-[#eef1f5] pt-3 text-xs text-[#98a2b3]">
        The timetable is the workbook the timetabler gets: a sheet per cohort, the CRN table and the teacher
        hours. Teachers come from Active teachers; a section nobody has chosen one for keeps the portal&apos;s name.
        The student handout is the one file here that students themselves read: a row each, alphabetical by
        family name, with their CRN and teacher written out under a colour per set. Reading a workbook back in
        is off for now. It matched a file&apos;s sets to the semester&apos;s by their code and
        made a new one where it could not match, so a set renamed since the file was written came back as a second set
        with the students moved into it. The schema is edited on the Group schema page instead.
      </p>
    </Modal>
  );
}
