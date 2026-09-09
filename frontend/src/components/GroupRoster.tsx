import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  clearExemption,
  fetchAssignments,
  fetchCohorts,
  fetchExemptions,
  fetchStudents,
  setExemption,
} from "@/services/studentDatabase";

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
  courses = [],
  onClose,
}: {
  open: boolean;
  cohortId: string;
  cohortName: string;
  scopeId: string;
  scopeCode: string;
  groupId: string;
  groupLabel: string;
  /**
   * The courses this group's set teaches, so a member can be marked as not taking one.
   *
   * Passed in rather than fetched: the page that opens this already holds the catalogue,
   * and a second read of it here would be a second answer to the same question.
   */
  courses?: { id: string; code: string }[];
  onClose: () => void;
}) {
  const client = useQueryClient();
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

  /*
   * Who in this group does not take one of its courses.
   *
   * Read from the server, not from a dismissed warning: an exemption is the department's
   * decision and has to be the same for whoever opens the page next.
   */
  const exemptions = useQuery({
    queryKey: ["exemptions", cohortId],
    queryFn: () => fetchExemptions(cohortId),
    enabled: open && Boolean(cohortId),
  });
  const excused = useMemo(() => {
    const held = new Set<string>();
    for (const row of exemptions.data ?? []) held.add(`${row.studentId}|${row.courseId}`);
    return held;
  }, [exemptions.data]);

  const toggle = useMutation({
    mutationFn: ({ studentId, courseId, on }: { studentId: string; courseId: string; on: boolean }) =>
      on ? setExemption(studentId, courseId) : clearExemption(studentId, courseId),
    onSuccess: () => {
      // The catalogue carries the count per section and the register's verdicts change
      // with it, so both are asked again rather than left to go stale on screen.
      void client.invalidateQueries({ queryKey: ["exemptions", cohortId] });
      void client.invalidateQueries({ queryKey: ["course-cards"] });
      void client.invalidateQueries({ queryKey: ["registration-check"] });
    },
  });

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
                    {/*
                      * One chip per course of the set: pressed means they do not take it.
                      *
                      * Outside the button above, which opens their record — a chip inside
                      * it would open the record on every press. Shown for every member
                      * rather than on hover, because "who is exempt from what" is read
                      * down the list, and a control that appears under the pointer cannot
                      * be read down anything.
                      */}
                    {courses.length ? (
                      <div className="flex flex-wrap gap-1 pb-1.5">
                        {courses.map((course) => {
                          const off = excused.has(`${member.studentId}|${course.id}`);
                          return (
                            <button
                              key={course.id}
                              type="button"
                              aria-pressed={off}
                              disabled={toggle.isPending}
                              title={
                                off
                                  ? `${member.name || member.studentId} does not take ${course.code}. Press to put them back in it.`
                                  : `Mark ${member.name || member.studentId} as not taking ${course.code}`
                              }
                              onClick={() =>
                                toggle.mutate({ studentId: member.studentId, courseId: course.id, on: !off })
                              }
                              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                off
                                  ? "bg-[#fdf9ee] text-[#8a6116] line-through"
                                  : "text-[#c8d0da] hover:bg-[#f2f4f7] hover:text-[#667085]"
                              }`}
                            >
                              {course.code}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
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
