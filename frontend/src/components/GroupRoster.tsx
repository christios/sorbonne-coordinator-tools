import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { ScreenLoading } from "@/components/ScreenLoading";
import { StudentRecord } from "@/components/StudentRecord";
import { rowText } from "@/services/copyCells";
import { EMPTY_HISTORY } from "@/services/pullHistory";
import { namesHeld, rowsHeld } from "@/services/rosterStore";
import { studentRows } from "@/services/rosterView";
import type { RosterRow } from "@/services/scenRosters";
import { fetchAssignments, fetchCohorts, fetchStudents } from "@/services/studentDatabase";

/**
 * Who is actually in this group, and who each of them is.
 *
 * The card says "18 of 20" and could answer every other question about a group but the
 * first one anybody asks. Getting the names meant the Students page, a cohort filter, a
 * group filter, and reading eighteen rows off a table built for three thousand.
 *
 * The names are this browser's, like every name in this application: the server holds
 * student ids and CRNs and is never told who they belong to. So a browser that has not
 * synced shows ids, says why, and is still useful — an id is what goes in a message to the
 * registrar anyway.
 */
export function GroupRoster({
  open,
  cohortId,
  cohortName,
  scopeId,
  scopeCode,
  groupId,
  groupLabel,
  onClose,
}: {
  open: boolean;
  cohortId: string;
  cohortName: string;
  scopeId: string;
  scopeCode: string;
  groupId: string;
  groupLabel: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  /** Whose record is open over the list, if any. */
  const [chosen, setChosen] = useState<string>("");

  // The same query keys the rest of the application uses, so these are usually in hand.
  const assignments = useQuery({
    queryKey: ["assignments", cohortId],
    queryFn: () => fetchAssignments(cohortId),
    enabled: open && Boolean(cohortId),
  });
  const names = useQuery({ queryKey: ["names-held"], queryFn: namesHeld, enabled: open, staleTime: 60_000 });
  const students = useQuery({ queryKey: ["students", ""], queryFn: () => fetchStudents(""), enabled: open });
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts, enabled: open });
  // What the portal last said about each of them, which is most of what a record shows.
  const portal = useQuery({ queryKey: ["rows-held"], queryFn: rowsHeld, enabled: open, staleTime: 60_000 });

  const members = useMemo(() => {
    const held = names.data ?? {};
    return Object.entries(assignments.data ?? {})
      .filter(([, placed]) => placed[scopeId] === groupId)
      .map(([studentId]) => ({ studentId, name: held[studentId] ?? "" }))
      // By name where there is one and by id where there is not, so the unsynced case is
      // still a list somebody can run down rather than an arbitrary order.
      .sort((left, right) => (left.name || `~${left.studentId}`).localeCompare(right.name || `~${right.studentId}`));
  }, [assignments.data, names.data, scopeId, groupId]);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? members.filter(
        (member) => member.name.toLowerCase().includes(needle) || member.studentId.toLowerCase().includes(needle),
      )
    : members;
  const unnamed = members.filter((member) => !member.name).length;

  /*
   * The row for whoever is open, built the way the table builds its own.
   *
   * `studentRows` is the one place that knows how a student, the portal's last answer
   * about them and their groups come together, and the record is written against exactly
   * that shape. Building a lesser one here would be a second, quietly different answer to
   * the same question.
   */
  const record = useMemo(() => {
    if (!chosen) return null;
    const rows = studentRows(
      (students.data ?? []).filter((student) => student.studentId === chosen),
      (portal.data ?? []) as RosterRow[],
    );
    return rows[0] ?? null;
  }, [chosen, students.data, portal.data]);

  const copy = () => {
    const text = [rowText(["Id", "Student"]), ...shown.map((member) => rowText([member.studentId, member.name]))].join("\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      {/*
        * One dialog at a time. Two of these stack at the same z-index and would both take
        * the Escape key, so a record opened from here replaces the list rather than
        * sitting on top of it; closing the record brings the list back, search and all.
        */}
      <Modal
        open={open && !record}
        title={`${scopeCode} ${groupLabel}`}
        description={`${members.length} student${members.length === 1 ? "" : "s"} in ${cohortName}`}
        onClose={onClose}
        footer={
          <button
            type="button"
            onClick={copy}
            disabled={!shown.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            <Copy size={14} aria-hidden="true" /> {copied ? "Copied" : `Copy ${needle ? "these" : "the list"}`}
          </button>
        }
      >
        {assignments.isLoading ? (
          <ScreenLoading label="Reading who is placed…" />
        ) : assignments.error ? (
          <p role="alert" className="text-sm text-[#a6292f]">{(assignments.error as Error).message}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-[#667085]">Nobody is in this group yet.</p>
        ) : (
          <>
            <label className="relative mb-3 block">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
              <input
                aria-label="Search this group"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or id"
                className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
              />
            </label>

            {unnamed ? (
              <p className="mb-2 text-xs text-[#98a2b3]">
                {unnamed === members.length
                  ? "This browser holds no names yet — sync the students and they fill in."
                  : `${unnamed} of them have no name in this browser yet.`}
              </p>
            ) : null}

            {shown.length === 0 ? (
              <p className="text-sm text-[#667085]">Nobody in this group matches “{query.trim()}”.</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto text-sm">
                {shown.map((member) => (
                  <li key={member.studentId} className="border-b border-[#f2f4f7] last:border-0">
                    <button
                      type="button"
                      onClick={() => setChosen(member.studentId)}
                      className="group flex w-full items-baseline justify-between gap-3 py-1.5 text-left hover:bg-[#f6f8fb]"
                    >
                      <span className={member.name ? "text-[#171717]" : "text-[#98a2b3]"}>
                        {member.name || "name not pulled yet"}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        <span className="font-mono text-xs text-[#98a2b3]">{member.studentId}</span>
                        <ChevronRight size={13} className="text-transparent group-hover:text-[#98a2b3]" aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Modal>

      {record ? (
        <StudentRecord
          open
          row={record}
          cohorts={cohorts.data ?? []}
          /*
           * No history, exactly as a record opened from the Cohorts table has none: the
           * pull history is kept per view, and neither page is looking at one. Everything
           * else on the record — the portal's fields, the groups, the registrations and
           * what the register makes of them — is there.
           */
          history={EMPTY_HISTORY}
          onClose={() => setChosen("")}
        />
      ) : null}
    </>
  );
}
