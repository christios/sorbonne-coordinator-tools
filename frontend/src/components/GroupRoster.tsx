import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { ScreenLoading } from "@/components/ScreenLoading";
import { rowText } from "@/services/copyCells";
import { namesHeld } from "@/services/rosterStore";
import { fetchAssignments } from "@/services/studentDatabase";

/**
 * Who is actually in this group.
 *
 * The card says "18 of 20" and every other question about a group could be answered from
 * it, but not the first one anybody asks — a coordinator wanting the names had to go to
 * the Students page, filter to the cohort, filter to the group, and read a table built for
 * three thousand rows to see eighteen.
 *
 * The names are this browser's, like every name in this application: the server holds
 * student ids and CRNs and is never told who they belong to. So a browser that has not
 * synced shows ids, says so, and is still useful — an id is what goes in an e-mail to the
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
  // The same key the rest of the application uses, so this is usually already in hand.
  const assignments = useQuery({
    queryKey: ["assignments", cohortId],
    queryFn: () => fetchAssignments(cohortId),
    enabled: open && Boolean(cohortId),
  });
  const names = useQuery({ queryKey: ["names-held"], queryFn: namesHeld, enabled: open, staleTime: 60_000 });

  const members = Object.entries(assignments.data ?? {})
    .filter(([, placed]) => placed[scopeId] === groupId)
    .map(([studentId]) => ({ studentId, name: (names.data ?? {})[studentId] ?? "" }))
    // By name where there is one, and by id where there is not, so the unsynced case is
    // still a list somebody can run down rather than an arbitrary order.
    .sort((left, right) => (left.name || `~${left.studentId}`).localeCompare(right.name || `~${right.studentId}`));
  const unnamed = members.filter((member) => !member.name).length;

  const copy = () => {
    const text = [rowText(["Id", "Student"]), ...members.map((member) => rowText([member.studentId, member.name]))].join("\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal
      open={open}
      title={`${scopeCode} ${groupLabel}`}
      description={`${members.length} student${members.length === 1 ? "" : "s"} in ${cohortName}`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={copy}
          disabled={!members.length}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
        >
          <Copy size={14} aria-hidden="true" /> {copied ? "Copied" : "Copy the list"}
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
          {unnamed ? (
            <p className="mb-2 text-xs text-[#98a2b3]">
              {unnamed === members.length
                ? "This browser holds no names yet — sync the students and they fill in."
                : `${unnamed} of them have no name in this browser yet.`}
            </p>
          ) : null}
          <ul className="max-h-80 overflow-y-auto text-sm">
            {members.map((member) => (
              <li key={member.studentId} className="flex items-baseline justify-between gap-3 border-b border-[#f2f4f7] py-1.5 last:border-0">
                <span className={member.name ? "text-[#171717]" : "text-[#98a2b3]"}>{member.name || "name not pulled yet"}</span>
                <span className="shrink-0 font-mono text-xs text-[#98a2b3]">{member.studentId}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
