import { useQueries } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { copyToClipboard } from "@/services/copyCells";
import { fetchRegistrationCheck } from "@/services/portalLists";
import { changesTable, registrationChanges } from "@/services/registrationChanges";
import type { Cohort } from "@/services/studentDatabase";

/**
 * The registrar's worklist, copied: which CRNs to add and which to drop, per student.
 *
 * The page can already say a student's registrations differ from the groups they are in.
 * This is that, handed to the person who acts on it, in the shape of the sheet they work
 * from — the id and the name once per block, then a line per CRN with the action beside it.
 *
 * One button in the toolbar and every question inside it. The choice of one cohort or all
 * of them is a decision taken at the moment of copying, and a picker sitting in the
 * toolbar would ask it of somebody every time they looked at the page, which is not when
 * they are answering it.
 *
 * The names are this browser's, like every name in this application; the server holds ids.
 * A browser that has not synced copies ids, which is what a registrar works from anyway.
 */
export function RegistrationChangesButton({
  cohorts,
  cohortId,
  cohortName,
  nameOf,
}: {
  cohorts: Cohort[];
  /** The cohort on screen, which is what "this cohort" means. */
  cohortId: string;
  cohortName: string;
  nameOf: (studentId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");

  /*
   * Every cohort is asked as soon as the dialog opens, because both answers are shown
   * before either is chosen — "this cohort (3)" against "all cohorts (10)" is the whole of
   * the decision, and a count that appeared only after choosing would be no help in making
   * the choice. They are the page's own query keys, so most of this is already in hand.
   */
  const checks = useQueries({
    queries: cohorts.map((cohort) => ({
      queryKey: ["registration-check", cohort.id],
      queryFn: () => fetchRegistrationCheck(cohort.id),
      retry: false,
      enabled: open,
    })),
  });
  const ready = open && checks.every((check) => !check.isPending);
  const byCohort = cohorts.map((cohort, index) =>
    registrationChanges(checks[index]?.data?.mismatches ?? [], nameOf, cohort.name),
  );
  const mine = byCohort[cohorts.findIndex((cohort) => cohort.id === cohortId)] ?? [];
  const everyone = byCohort.flat();
  // A cohort whose semester is not linked to a portal term has no answer to give, and a
  // silent zero over a question nobody could ask is the wrong kind of quiet.
  const unanswered = checks.filter((check) => check.isError).length;

  const copy = async (changes: typeof mine) => {
    if (!changes.length) return;
    const done = await copyToClipboard(changesTable(changes));
    setCopied(done ? `${changes.length} line${changes.length === 1 ? "" : "s"} copied` : "Could not copy");
    window.setTimeout(() => setCopied(""), 2000);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Copy the CRNs to add and drop, as a table for the registrar"
        aria-label="Registrations to change"
        className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <ClipboardList size={15} aria-hidden="true" />
      </button>

      <Modal
        open={open}
        title="Registrations to change"
        description="The CRNs to add and to drop so that every student holds the sections their groups give them. Copied as a table: the id and the name once per student, then a line for each CRN."
        onClose={() => setOpen(false)}
      >
        {!ready ? (
          <p className="text-sm text-[#667085]">Reading the register…</p>
        ) : (
          <div className="space-y-2">
            <Choice
              label={cohortName || "This cohort"}
              changes={mine}
              copied={copied}
              onCopy={() => copy(mine)}
            />
            <Choice
              label={`All ${cohorts.length} cohorts`}
              changes={everyone}
              copied={copied}
              onCopy={() => copy(everyone)}
            />
            {unanswered ? (
              <p className="text-xs text-[#98a2b3]">
                {unanswered} cohort{unanswered === 1 ? "" : "s"} could not be checked — no portal term is linked to
                its semester, so nothing is claimed about it either way.
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}

/** One thing to copy, with how much of it there is — which is the whole decision. */
function Choice({
  label,
  changes,
  copied,
  onCopy,
}: {
  label: string;
  changes: { studentId: string }[];
  copied: string;
  onCopy: () => void;
}) {
  const students = new Set(changes.map((change) => change.studentId)).size;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#e4e8ef] px-3 py-2">
      <span className="text-sm font-medium text-[#344054]">{label}</span>
      <span className="text-xs text-[#667085]">
        {changes.length
          ? `${changes.length} line${changes.length === 1 ? "" : "s"}, ${students} student${students === 1 ? "" : "s"}`
          : "nothing to change"}
      </span>
      <button
        type="button"
        disabled={!changes.length}
        onClick={onCopy}
        className="ml-auto rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
      >
        {copied || "Copy"}
      </button>
    </div>
  );
}
