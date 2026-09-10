import { useQueries } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
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
 * One cohort or all of them, because both are asked: a coordinator settling one year wants
 * that year, and the person who takes it to the registrar wants the lot in one paste.
 *
 * The names are this browser's, like every name in this application; the server holds ids.
 * A browser that has not synced copies ids, which is what a registrar works from anyway.
 */
export function RegistrationChangesButton({
  cohorts,
  cohortId,
  nameOf,
}: {
  cohorts: Cohort[];
  /** The cohort on screen, which is what "This cohort" means. */
  cohortId: string;
  nameOf: (studentId: string) => string;
}) {
  const [scope, setScope] = useState<"cohort" | "all">("cohort");
  const [copied, setCopied] = useState("");

  const wanted = scope === "all" ? cohorts : cohorts.filter((cohort) => cohort.id === cohortId);
  // The same query key the page uses per cohort, so this is usually already in hand.
  const checks = useQueries({
    queries: wanted.map((cohort) => ({
      queryKey: ["registration-check", cohort.id],
      queryFn: () => fetchRegistrationCheck(cohort.id),
      retry: false,
    })),
  });

  const ready = checks.every((check) => !check.isPending);
  const changes = wanted.flatMap((cohort, index) =>
    registrationChanges(checks[index]?.data?.mismatches ?? [], nameOf, cohort.name),
  );
  // A cohort whose semester is not linked to a portal term has no answer to give, and
  // saying "0 changes" over a question nobody could ask would be the wrong kind of quiet.
  const unanswered = checks.filter((check) => check.isError).length;

  const copy = async () => {
    if (!changes.length) return;
    const done = await copyToClipboard(changesTable(changes));
    setCopied(done ? `${changes.length} line${changes.length === 1 ? "" : "s"} copied` : "Could not copy");
    window.setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-40">
        <SelectMenu
          label="Registrations to copy"
          value={scope}
          onChange={(value) => setScope(value as "cohort" | "all")}
          options={[
            { value: "cohort", label: "This cohort" },
            { value: "all", label: "All cohorts" },
          ]}
        />
      </div>
      <button
        type="button"
        onClick={copy}
        disabled={!ready || changes.length === 0}
        title={
          ready
            ? changes.length
              ? "Copy the CRNs to add and drop, as a table"
              : "Nothing to change — every student holds exactly the sections their groups give them"
            : "Reading the register…"
        }
        className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
      >
        <ClipboardList size={15} aria-hidden="true" />
        {copied || (ready ? `Registrations to change${changes.length ? ` (${changes.length})` : ""}` : "Reading…")}
      </button>
      {unanswered ? (
        <span className="text-xs text-[#98a2b3]">
          {unanswered} cohort{unanswered === 1 ? "" : "s"} could not be checked — no portal term linked.
        </span>
      ) : null}
    </div>
  );
}
