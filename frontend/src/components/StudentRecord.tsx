import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";

import { Modal } from "@/components/Modal";
import { labelOf } from "@/services/discrepancies";
import { type Mismatch, describeMismatch, fetchRegistrationCheck, fetchRegistrations, fetchTermLinks } from "@/services/portalLists";
import { historyFor, type PullHistory } from "@/services/pullHistory";
import type { StudentRow } from "@/services/rosterView";
import { fetchAssignments, fetchCatalogue, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/** The portal fields worth reading first; the rest follow alphabetically. */
const LEADING = ["FULL_NAME", "SPRIDEN_ID", "PSUAD_EMAIL", "YEARLEVEL_CODE", "MAJOR_CODE_DESC", "STST_CODE", "ESTS_CODE", "PROGRAM_CODE", "TERM_CODE"];

/**
 * Everything this application knows about one student, on one screen.
 *
 * The portal's fields as this browser last saw them, the cohort and when they were put
 * there, the groups they sit in and the CRNs those stand for, the registrar's actual
 * registrations beside them with the differences said plainly, and the record's history
 * of changes. It answers "which courses is this student in?" without a trip to the
 * portal, and "is that what we meant?" without a spreadsheet.
 */
export function StudentRecord({
  open,
  row,
  cohorts,
  history,
  onClose,
}: {
  open: boolean;
  row: StudentRow;
  cohorts: Cohort[];
  history: PullHistory;
  onClose: () => void;
}) {
  const cohortId = row.cohortId ?? "";
  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  const registrations = useQuery({
    queryKey: ["registrations", row.studentId],
    queryFn: () => fetchRegistrations(row.studentId),
    enabled: open,
    retry: false,
  });
  const check = useQuery({
    queryKey: ["registration-check", cohortId],
    queryFn: () => fetchRegistrationCheck(cohortId),
    enabled: open && Boolean(cohortId),
    retry: false,
  });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: open });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open, retry: false });
  const catalogue = useQuery({
    queryKey: ["catalogue", cohortId, ""],
    queryFn: () => fetchCatalogue(cohortId),
    enabled: open && Boolean(cohortId),
  });
  const assignments = useQuery({
    queryKey: ["assignments", cohortId],
    queryFn: () => fetchAssignments(cohortId),
    enabled: open && Boolean(cohortId),
  });

  const termName = (termId: string) => (terms.data ?? []).find((term) => term.id === termId)?.name ?? termId;
  const held = assignments.data?.[row.studentId] ?? {};
  /** The groups this student holds, with the CRNs each stands for. */
  const placements = (catalogue.data?.scopes ?? [])
    .filter((scope) => held[scope.id])
    .map((scope) => {
      const group = scope.groups.find((candidate) => candidate.id === held[scope.id]);
      return {
        scope,
        group,
        crns: scope.courses.map((course) => ({ courseCode: course.code, crn: group?.crns[course.id]?.crn ?? "" })),
      };
    });
  const registered = new Set((registrations.data ?? []).filter((r) => r.status === "in_portal").map((r) => r.crn));
  const mismatches: Mismatch[] = (check.data ?? []).filter((mismatch) => mismatch.studentId === row.studentId);
  const entries = historyFor(history, row.studentId);
  const fields = Object.entries(row.portal).filter(([, value]) => String(value ?? "").trim());
  fields.sort(([a], [b]) => {
    const ia = LEADING.indexOf(a);
    const ib = LEADING.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  return (
    <Modal
      open={open}
      title={row.name || row.studentId}
      description={[
        row.studentId,
        row.status === "not_in_portal" ? "no longer in the portal" : "in the portal",
        cohort ? cohort.name : "in no cohort",
      ].join(" · ")}
      onClose={onClose}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold text-[#344054]">From the portal</h3>
          <p className="mb-2 text-xs text-[#98a2b3]">As this browser last saw it. Nothing here is on the server.</p>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
            {fields.map(([field, value]) => (
              <div key={field} className="contents">
                <dt className="text-[#667085]">{labelOf(field)}</dt>
                <dd className="text-[#171717]">{String(value)}</dd>
              </div>
            ))}
            {fields.length === 0 ? <p className="col-span-2 text-[#667085]">No portal pull holds this student.</p> : null}
          </dl>
        </section>

        <section className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-[#344054]">Groups</h3>
            {!cohortId ? (
              <p className="text-sm text-[#667085]">In no cohort, so in no group.</p>
            ) : placements.length === 0 ? (
              <p className="text-sm text-[#667085]">{cohort?.name}: in no group yet.</p>
            ) : (
              <ul className="space-y-2 text-sm" aria-label="Groups">
                {placements.map(({ scope, group, crns }) => (
                  <li key={scope.id}>
                    <span className="font-semibold text-[#171717]">
                      {scope.code} {group?.label ?? "?"}
                    </span>
                    <span className="text-[#98a2b3]"> · {termName(scope.termId ?? "")}</span>
                    <ul className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[#667085]">
                      {crns.map((cell) => (
                        <li key={cell.courseCode} className="inline-flex items-center gap-1">
                          {cell.courseCode} {cell.crn || "—"}
                          {cell.crn && registered.has(cell.crn) ? (
                            <Check size={12} className="text-[#2f6b3d]" aria-label="registered" />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#344054]">Registered in the portal</h3>
            {registrations.isLoading ? (
              <p className="text-sm text-[#667085]">Reading…</p>
            ) : registrations.error ? (
              <p className="text-sm text-[#a6292f]">{(registrations.error as Error).message}</p>
            ) : (registrations.data ?? []).length === 0 ? (
              <p className="text-sm text-[#667085]">No registrations pulled for this student. Sync a Registrations filter that covers them.</p>
            ) : (
              <table className="w-full text-left text-sm" aria-label="Registrations">
                <thead className="text-xs uppercase tracking-wide text-[#667085]">
                  <tr>
                    <th className="py-1 font-semibold">Term</th>
                    <th className="py-1 font-semibold">CRN</th>
                    <th className="py-1 font-semibold">Course</th>
                    <th className="py-1 font-semibold">Teacher</th>
                  </tr>
                </thead>
                <tbody>
                  {(registrations.data ?? []).map((registration) => (
                    <tr
                      key={`${registration.termCode}|${registration.crn}`}
                      className={`border-t border-[#eef1f5] ${registration.status === "not_in_portal" ? "text-[#98a2b3] line-through" : ""}`}
                    >
                      <td className="py-1 tabular-nums">{registration.termCode}</td>
                      <td className="py-1 tabular-nums">{registration.crn}</td>
                      <td className="py-1">
                        {registration.courseCode}
                        {registration.title ? <span className="block text-xs text-[#98a2b3]">{registration.title}</span> : null}
                      </td>
                      <td className="py-1 text-[#667085]">{registration.teacherName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mismatches.length ? (
              <ul className="mt-2 space-y-1 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]" aria-label="Differences">
                {mismatches.map((mismatch) => (
                  <li key={`${mismatch.termCode}|${mismatch.courseCode}|${mismatch.kind}`} className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-1 shrink-0" aria-hidden="true" />
                    <span>{describeMismatch(mismatch)}</span>
                  </li>
                ))}
              </ul>
            ) : cohortId && check.data && (registrations.data ?? []).length ? (
              <p className="mt-2 text-xs text-[#2f6b3d]">Registrations agree with the groups.</p>
            ) : null}
            {links.data && Object.keys(links.data).length === 0 && cohortId ? (
              <p className="mt-2 text-xs text-[#98a2b3]">No semester is linked to a portal term yet, so nothing is compared. Set the portal term on the Semesters page.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-[#344054]">History</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-[#667085]">No changes recorded in this browser&apos;s pull history.</p>
        ) : (
          <ul className="mt-1 space-y-1.5 text-sm" aria-label="History">
            {entries.map((entry) => (
              <li key={entry.pullId} className="flex flex-wrap items-baseline gap-x-3">
                <span className="tabular-nums text-[#98a2b3]">{new Date(entry.at).toLocaleDateString()}</span>
                {entry.kind === "arrived" ? (
                  <span className="text-[#2f6b3d]">first seen</span>
                ) : entry.kind === "departed" ? (
                  <span className="text-[#a6292f]">no longer returned</span>
                ) : (
                  <span className="text-[#344054]">
                    {entry.changes.map((change) => `${labelOf(change.field)}: ${change.from || "—"} → ${change.to || "—"}`).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
