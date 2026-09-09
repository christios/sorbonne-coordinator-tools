import { useMutation } from "@tanstack/react-query";
import { CalendarSearch, Loader2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { describeSweep, sweepFacilityTimetable, type FacilitySweep } from "@/services/facilitySync";
import type { PullProgress } from "@/services/scenRosters";

/**
 * Ask the registrar what it has actually booked for this semester's sections.
 *
 * Its own button rather than a step of the portal sync, and on purpose. A sync is six
 * lists and about a minute; this is one call per section, two at a time, and a term is a
 * hundred and sixty of them — minutes of steady asking. Folding it into the everyday sync
 * would make the everyday sync something nobody runs.
 *
 * It asks before it starts, because it says out loud that it is about to ask the registrar
 * about other departments' sections too. That is the whole reason the answer is worth
 * having — a student's language hour colliding with our lecture is invisible from our own
 * CRNs alone — and it is still somebody else's rooms, so it is asked rather than assumed.
 */
export function TimetableSweepButton({ termCode, termName }: { termCode: string; termName: string }) {
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [done, setDone] = useState<FacilitySweep | null>(null);

  const sweep = useMutation({
    mutationFn: async () => {
      setDone(null);
      setProgress(null);
      return sweepFacilityTimetable(termCode, { theirsToo: true }, (at: PullProgress) => setProgress(at));
    },
    onSettled: () => setAsking(false),
    onSuccess: setDone,
  });

  if (!termCode) return null;

  const at = progress && progress.total ? `${progress.fetched} of ${progress.total}` : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={sweep.isPending}
        title="Ask the registrar's timetable what each section is booked for"
        className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
      >
        {sweep.isPending ? (
          <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <CalendarSearch size={15} className="shrink-0" aria-hidden="true" />
        )}
        {sweep.isPending ? `Asking the registrar… ${at}` : "Pull the registrar's timetable"}
      </button>

      <ConfirmDialog
        open={asking}
        busy={sweep.isPending}
        title={`Ask the registrar's timetable for ${termName || termCode}?`}
        description={
          "One request per section, two at a time, so a full semester takes several minutes — the portal " +
          "starts answering with empty lists if it is pushed harder, and an empty list is indistinguishable " +
          "from a section with nothing booked. It asks about our own sections and about the other " +
          "departments' sections our students are registered in, which is where the collisions nobody can " +
          "currently see are. Nothing is written to the portal."
        }
        confirmLabel="Ask the registrar"
        onConfirm={() => sweep.mutate()}
        onClose={() => setAsking(false)}
      />

      {done ? (
        <span role="status" className="text-xs text-[#667085]">
          {describeSweep(done)}
        </span>
      ) : null}
      {sweep.error ? (
        <span role="alert" className="text-xs text-[#a6292f]">
          {(sweep.error as Error).message}
        </span>
      ) : null}
    </>
  );
}
