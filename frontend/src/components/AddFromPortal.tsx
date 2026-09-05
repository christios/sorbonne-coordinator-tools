import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { fetchTermCrns } from "@/services/portalLists";
import { type PortalCourseChoice, type SeedRow, portalCourses, proposeRows, seedSteps } from "@/services/portalSeed";
import { type Cohort, addCourse, addGroup, fetchCatalogue, setGroupCrn } from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";

/**
 * A course card from the portal's list.
 *
 * Choose the cohort and semester, then the course as the portal names it; its CRNs are
 * listed with the portal's teacher, and each is given a group set and a group. Nothing
 * is typed that the portal already knows.
 */
export function AddFromPortal({
  open,
  cohorts,
  terms,
  onClose,
  onAdded,
}: {
  open: boolean;
  cohorts: Cohort[];
  terms: TimetableTerm[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const client = useQueryClient();
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [courseCode, setCourseCode] = useState("");
  const [rows, setRows] = useState<SeedRow[]>([]);
  useEffect(() => {
    if (!cohortId && cohorts[0]) setCohortId(cohorts[0].id);
    if (!termId && terms[0]) setTermId(terms[0].id);
  }, [cohorts, terms, cohortId, termId]);

  const portal = useQuery({ queryKey: ["portal-crns", termId], queryFn: () => fetchTermCrns(termId), enabled: open && Boolean(termId), retry: false });
  const catalogue = useQuery({ queryKey: ["catalogue", cohortId, termId], queryFn: () => fetchCatalogue(cohortId, termId), enabled: open && Boolean(cohortId && termId) });
  const scopes = useMemo(() => catalogue.data?.scopes ?? [], [catalogue.data]);
  const courses = useMemo(() => portalCourses(portal.data?.crns ?? {}), [portal.data]);
  const course: PortalCourseChoice | null = courses.find((candidate) => candidate.courseCode === courseCode) ?? null;

  // A first guess whenever the course or the sets change; the table below corrects it.
  useEffect(() => {
    setRows(course ? proposeRows(course, scopes[0] ?? null) : []);
  }, [course, scopes]);

  const steps = course ? seedSteps(course, rows, scopes) : [];
  const add = useMutation({
    mutationFn: async () => {
      // Made in order, remembering what each step produced so the next can use it.
      const courseIds = new Map<string, string>();
      const groupIds = new Map<string, string>();
      for (const scope of scopes) {
        for (const held of scope.courses) courseIds.set(`${scope.id}|${held.code.toUpperCase()}`, held.id);
        for (const group of scope.groups) groupIds.set(`${scope.id}|${group.label.toUpperCase()}`, group.id);
      }
      for (const step of steps) {
        if (step.kind === "course") {
          const made = await addCourse(step.scopeId, { code: step.code, name: step.name, component: step.component });
          courseIds.set(`${step.scopeId}|${step.code.toUpperCase()}`, made.id);
        } else if (step.kind === "group") {
          const made = await addGroup(step.scopeId, { label: step.label });
          groupIds.set(`${step.scopeId}|${step.label.toUpperCase()}`, made.id);
        } else {
          const groupId = groupIds.get(`${step.scopeId}|${step.groupLabel.toUpperCase()}`);
          const courseId = courseIds.get(`${step.scopeId}|${step.code.toUpperCase()}`);
          if (groupId && courseId) await setGroupCrn(groupId, courseId, { crn: step.crn, teacher: step.teacherName });
        }
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["catalogue"] });
      client.invalidateQueries({ queryKey: ["course-cards"] });
      client.invalidateQueries({ queryKey: ["publication"] });
      setCourseCode("");
      onAdded();
    },
  });

  const field = "rounded-md border border-[#cbd5e1] px-2 py-1 text-sm";
  const linked = Boolean(portal.data?.portalTermCode);

  return (
    <Modal
      open={open}
      size="wide"
      title="Add a course from the portal"
      description="Pick the course as the portal lists it; say which set and group each of its CRNs is. The portal's teacher comes across to be confirmed on the card."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
          <button type="button" disabled={steps.length === 0 || add.isPending} onClick={() => add.mutate()} className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">
            {add.isPending ? "Adding…" : `Add ${steps.filter((step) => step.kind === "section").length} section${steps.filter((step) => step.kind === "section").length === 1 ? "" : "s"}`}
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectMenu label="Cohort" value={cohortId} onChange={setCohortId} options={cohorts.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
        <SelectMenu label="Semester" value={termId} onChange={setTermId} placeholder="Choose a semester" options={terms.map((term) => ({ value: term.id, label: term.name }))} />
        <SelectMenu
          label="Course"
          value={courseCode}
          placeholder={!termId ? "Choose a semester first" : !linked ? "Semester not linked to a portal term" : courses.length ? "Which course…" : "No portal CRNs pulled for this term"}
          searchable
          disabled={!linked || courses.length === 0}
          onChange={setCourseCode}
          options={courses.map((candidate) => ({ value: candidate.courseCode, label: candidate.courseCode, badge: String(candidate.sections.length), searchText: candidate.title }))}
        />
      </div>
      {termId && portal.data && !linked ? (
        <p className="mt-3 text-sm text-[#8a6116]">This semester is not linked to a portal term. Set the portal term on the Semesters page, and sync the Courses list for it.</p>
      ) : null}
      {course ? (
        <>
          <p className="mt-4 text-sm text-[#344054]">
            <span className="font-semibold">{course.courseCode}</span> {course.title} · {course.sections.length} CRN{course.sections.length === 1 ? "" : "s"} in the portal
          </p>
          {scopes.length === 0 ? (
            <p className="mt-2 text-sm text-[#a6292f]">This cohort has no group sets in this semester yet. Make one under Group sets first.</p>
          ) : null}
          <table className="mt-2 w-full text-left text-sm" aria-label="Sections to add">
            <thead className="text-[11px] uppercase tracking-wide text-[#98a2b3]">
              <tr>
                <th className="py-1 pr-3 font-semibold">CRN</th>
                <th className="py-1 pr-3 font-semibold">Portal teacher</th>
                <th className="py-1 pr-3 font-semibold">Group set</th>
                <th className="py-1 pr-3 font-semibold">Group</th>
                <th className="py-1 font-semibold">Skip</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.crn} className={`border-t border-[#eef1f5] ${row.skip ? "opacity-50" : ""}`}>
                  <td className="py-1.5 pr-3 tabular-nums">{row.crn}</td>
                  <td className="py-1.5 pr-3 text-[#667085]">{row.teacherName || "—"}</td>
                  <td className="py-1.5 pr-3">
                    <select aria-label={`Group set for ${row.crn}`} value={row.scopeId} onChange={(event) => setRows(rows.map((held, at) => (at === index ? { ...held, scopeId: event.target.value } : held)))} className={field}>
                      <option value="">—</option>
                      {scopes.map((scope) => (
                        <option key={scope.id} value={scope.id}>{scope.code}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input aria-label={`Group for ${row.crn}`} value={row.groupLabel} onChange={(event) => setRows(rows.map((held, at) => (at === index ? { ...held, groupLabel: event.target.value } : held)))} className={`w-20 ${field}`} />
                  </td>
                  <td className="py-1.5">
                    <input type="checkbox" aria-label={`Skip ${row.crn}`} checked={row.skip} onChange={(event) => setRows(rows.map((held, at) => (at === index ? { ...held, skip: event.target.checked } : held)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {steps.some((step) => step.kind === "group") ? (
            <p className="mt-2 text-xs text-[#667085]">
              New groups will be made: {steps.filter((step) => step.kind === "group").map((step) => (step.kind === "group" ? step.label : "")).join(", ")}.
            </p>
          ) : null}
        </>
      ) : null}
      {add.error ? <p role="alert" className="mt-3 text-sm text-[#a6292f]">{(add.error as Error).message}</p> : null}
    </Modal>
  );
}
