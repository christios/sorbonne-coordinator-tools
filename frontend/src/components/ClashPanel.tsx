import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import type { GroupClash } from "@/services/publication";
import { clashName, describeClashWindow } from "@/services/publicationView";

const CLASHES_SHOWN = 5;

/**
 * Groups that meet at the same hour, so cannot share a student.
 *
 * The timetable knows when every CRN meets; the groups were built here; this is where
 * the two are held against each other. Worst first, and only the worst by default.
 */
export function ClashPanel({ clashes, onShow }: { clashes: GroupClash[]; onShow?: (studentIds: string[]) => void }) {
  const [showingAll, setShowingAll] = useState(false);
  if (clashes.length === 0) return null;
  const shown = showingAll ? clashes : clashes.slice(0, CLASHES_SHOWN);

  return (
    <section className="mt-4 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
        {clashes.length === 1 ? "One pair of groups meets" : `${clashes.length} pairs of groups meet`} at the same
        hour, so cannot share a student.
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((clash) => (
          <li key={clash.groups.map((group) => group.id).join("|")} className="flex flex-wrap items-baseline gap-x-2">
            <b>{clashName(clash)}</b>
            <span>{clash.windows.map(describeClashWindow).join("; ")}</span>
            <span className="text-[#a07a2a]">
              · {clash.students.length ? `${clash.students.length} student${clash.students.length === 1 ? "" : "s"} in both` : "nobody in both yet"}
            </span>
            {onShow && clash.students.length ? (
              <button type="button" onClick={() => onShow(clash.students)} className="font-semibold text-[#1f4e79] underline">
                Show them in Students
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {clashes.length > CLASHES_SHOWN ? (
        <button type="button" onClick={() => setShowingAll((current) => !current)} className="mt-1 font-semibold text-[#1f4e79] underline">
          {showingAll ? "Show fewer" : `Show all ${clashes.length} pairs`}
        </button>
      ) : null}
    </section>
  );
}
