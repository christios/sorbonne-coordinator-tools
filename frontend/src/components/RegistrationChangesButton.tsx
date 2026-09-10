import { useQueries } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { copyTable } from "@/services/copyCells";
import { fetchRegistrationCheck } from "@/services/portalLists";
import { CHANGE_COLUMNS, changesRows, noteChanges, registrationChanges } from "@/services/registrationChanges";
import type { Warning, WarningSource } from "@/services/discrepancies";
import type { Cohort } from "@/services/studentDatabase";

/**
 * Which records to copy — any combination of the three, not one of them.
 *
 * The page's own filter narrows to one at a time because a table shows one thing at a
 * time. A copy is taken to somebody, and who that is decides the combination: the
 * registrar wants the registrations and the clashes and not a word about majors;
 * admissions want the opposite; a coordinator taking the whole picture into a meeting
 * wants all three. One-at-a-time meant copying twice and pasting twice.
 */
const RECORDS: { id: WarningSource; name: string }[] = [
  { id: "record", name: "Admissions" },
  { id: "registration", name: "Register" },
  { id: "timetabling", name: "Timetabling" },
];

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
  yearOf,
  warningsIn,
}: {
  cohorts: Cohort[];
  /** The cohort on screen, which is what "this cohort" means. */
  cohortId: string;
  cohortName: string;
  nameOf: (studentId: string) => string;
  /** The student's own year level, as the portal has it — not the cohort's. */
  yearOf: (studentId: string) => string;
  /**
   * The warnings the page has already judged, per cohort — where the admissions and
   * timetabling lines come from. Asking the checks again here would be a second answer to
   * a question the page has answered, and two answers are two things to disagree.
   */
  warningsIn: (cohortId: string) => Warning[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  // All three to begin with, which is the old "All" and the commonest answer.
  const [records, setRecords] = useState<Set<WarningSource>>(() => new Set(RECORDS.map((record) => record.id)));
  const toggle = (id: WarningSource) =>
    setRecords((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
    [
      ...registrationChanges(checks[index]?.data?.mismatches ?? [], nameOf, cohort.name, yearOf),
      ...noteChanges(warningsIn(cohort.id), nameOf, cohort.name, yearOf),
    ].filter((change) => records.has(change.source)),
  );
  const mine = byCohort[cohorts.findIndex((cohort) => cohort.id === cohortId)] ?? [];
  const everyone = byCohort.flat();
  // A cohort whose semester is not linked to a portal term has no answer to give, and a
  // silent zero over a question nobody could ask is the wrong kind of quiet.
  const unanswered = checks.filter((check) => check.isError).length;

  const copy = async (changes: typeof mine) => {
    if (!changes.length) return;
    // Both flavours: a table for the mail client, tab-separated text for the spreadsheet.
    const done = await copyTable([...CHANGE_COLUMNS], changesRows(changes));
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
        description="One table for whoever acts on it: the id and the name once per student, then a line each. A register line carries the CRN to add or drop; an admissions or timetabling line carries what is wrong with them instead. Choose the records that whoever receives it acts on."
        onClose={() => setOpen(false)}
      >
        {/*
          * Which record, narrowing the LINES rather than the students — the same reading
          * as the page's own filter. A student flagged by two records appears under each,
          * carrying only that record's lines.
          */}
        <div role="group" aria-label="Which records to copy" className="mb-3 inline-flex flex-wrap gap-1 rounded-md border border-[#d3d9e2] bg-white p-0.5">
          {RECORDS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={records.has(option.id)}
              onClick={() => toggle(option.id)}
              className={`rounded px-2.5 py-1 text-sm font-semibold ${
                records.has(option.id) ? "bg-[#1f4e79] text-white" : "text-[#344054] hover:bg-[#f2f4f7]"
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
        {records.size === 0 ? (
          <p className="mb-3 text-xs text-[#98a2b3]">No record chosen, so there is nothing to copy.</p>
        ) : null}

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
