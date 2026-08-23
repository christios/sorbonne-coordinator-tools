import { PanelRightClose } from "lucide-react";
import { useMemo } from "react";

import { CopyButton } from "@/components/CopyButton";
import { tableText } from "@/services/copyCells";
import {
  historyFor,
  historySummary,
  type PullHistory,
} from "@/services/pullHistory";
import type { StudentRow } from "@/services/rosterView";
import type { StudentColumn } from "@/services/studentColumns";

/**
 * What the portal has said about one student, pull after pull.
 *
 * Only the pulls something happened in are listed. There will be a pull most days and a
 * given student changes a handful of times a term, so showing every pull would bury the
 * three that matter under ninety that say "no change" — the count of those is given once,
 * at the bottom, rather than ninety times.
 *
 * The same right-hand panel as the syllabus editor's edit history, and for the same
 * reason: it is a record of what changed, read beside the thing it changed.
 */
export function StudentHistoryPane({
  row,
  history,
  columns,
  onClose,
}: {
  row: StudentRow | null;
  history: PullHistory;
  columns: StudentColumn[];
  onClose: () => void;
}) {
  const entries = useMemo(
    () => (row ? historyFor(history, row.studentId) : []),
    [history, row],
  );
  const summary = useMemo(
    () => (row ? historySummary(history, row.studentId) : { shown: 0, total: 0, quiet: 0 }),
    [history, row],
  );

  if (!row) return null;

  /** Portal field names are not what the table calls them. */
  const labelFor = (field: string) =>
    columns.find((column) => column.id === `portal:${field}`)?.displayName ?? field;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[#d9dee7] bg-white shadow-2xl"
      aria-label="Student history"
    >
      <div className="flex items-start justify-between border-b border-[#d9dee7] p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#a6292f]">Portal history</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-[#171717]">
            {row.name || row.studentId}
          </h2>
          <p className="mt-1 text-xs text-[#667085]">
            {row.name ? `${row.studentId} · ` : ""}
            {summary.total === 0
              ? "No pulls recorded in this browser yet"
              : `${summary.shown} of ${summary.total} pull${summary.total === 1 ? "" : "s"} changed something`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <CopyButton
            label="Copy this history"
            text={() =>
              tableText(
                ["When", "What", "Field", "From", "To"],
                entries.flatMap((entry) =>
                  entry.changes.length
                    ? entry.changes.map((change) => [
                        when(entry.at),
                        "changed",
                        labelFor(change.field),
                        change.from,
                        change.to,
                      ])
                    : [[when(entry.at), entry.kind, "", "", ""]],
                ),
              )
            }
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-[#475467] hover:bg-[#f2f4f7]"
            aria-label="Close student history"
          >
            <PanelRightClose size={19} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#d0d5dd] p-4 text-sm leading-6 text-[#667085]">
            {summary.total === 0
              ? "Nothing recorded yet. Each sync in this browser adds to this history."
              : `Nothing about this student has changed across ${summary.total} pull${summary.total === 1 ? "" : "s"}.`}
          </p>
        ) : (
          <ol className="space-y-4">
            {entries.map((entry) => (
              <li key={`${entry.pullId}-${entry.kind}`} className="rounded-md border border-[#d9dee7] p-4">
                <p className="text-xs text-[#667085]">
                  {when(entry.at)}
                  {entry.kind === "arrived" ? " · first returned by the portal" : null}
                  {entry.kind === "departed" ? " · no longer returned by the portal" : null}
                </p>
                {entry.changes.length ? (
                  <dl className="mt-3 space-y-2 text-sm">
                    {entry.changes.map((change) => (
                      <div key={change.field} className="rounded bg-[#f7f8fa] p-2">
                        <dt className="text-xs font-semibold text-[#344054]">
                          {labelFor(change.field)}
                        </dt>
                        <dd className="mt-1 leading-6">
                          <span className="rounded bg-[#fee4e2] px-1 text-[#b42318] line-through">
                            {change.from || "—"}
                          </span>
                          <span aria-hidden="true" className="px-1 text-[#667085]">
                            →
                          </span>
                          <span className="rounded bg-[#dcfae6] px-1 font-semibold text-[#067647]">
                            {change.to || "—"}
                          </span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {summary.quiet > 0 ? (
          <p className="mt-4 text-center text-xs text-[#98a2b3]">
            {summary.quiet} pull{summary.quiet === 1 ? "" : "s"} with no change to this student
            {summary.quiet === 1 ? " is" : " are"} not listed.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function when(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(at),
  );
}
