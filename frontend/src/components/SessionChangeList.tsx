import { describeChange, type SessionChange } from "@/services/sessionChanges";
import { formatShortDateTime } from "@/services/weekSchedule";

/**
 * The notes on a set of classes, as a list: what was said, about which hour, by whom.
 *
 * `orphaned` names the notes whose hour the registrar no longer has a class in — a
 * sweep moved or removed the meeting after the note was written. Kept on the list and
 * said, rather than dropped: a note that vanished with a moved slot would be exactly the
 * hour a teacher was paid for twice or not at all.
 */
export function SessionChangeList({
  changes,
  orphaned = new Set<string>(),
  nameOf,
  empty,
}: {
  changes: SessionChange[];
  orphaned?: ReadonlySet<string>;
  /** What to call a CRN on the line — the course, the group — when the list spans several. */
  nameOf?: (crn: string) => string;
  empty: string;
}) {
  if (changes.length === 0) return <p className="text-sm text-[#667085]">{empty}</p>;
  return (
    <ul className="divide-y divide-[#f2f4f7] text-sm" aria-label="Changes to classes">
      {changes.map((change) => (
        <li key={change.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
          <span className="tabular-nums text-[#344054]">{formatShortDateTime(change.meetsOn, change.startsAt, change.endsAt)}</span>
          {nameOf ? <span className="text-[#667085]">{nameOf(change.crn)}</span> : null}
          <span className={`font-medium ${change.kind === "cancelled" ? "text-[#a6292f]" : "text-[#1f4e79]"}`}>{describeChange(change)}</span>
          {change.note ? <span className="text-[#667085]">{change.note}</span> : null}
          {orphaned.has(change.id) ? (
            <span className="text-xs text-[#8a6116]">the registrar no longer has a class at this hour</span>
          ) : null}
          <span className="ml-auto text-xs text-[#98a2b3]">
            {change.authorName || change.authorEmail || "somebody"} · {new Date(change.updatedAt).toLocaleDateString("en-GB")}
          </span>
        </li>
      ))}
    </ul>
  );
}
