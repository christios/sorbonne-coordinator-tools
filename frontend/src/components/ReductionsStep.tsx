import { Loader2 } from "lucide-react";
import { useState } from "react";

import { PartCard, ReductionFields, ReductionTotals } from "@/components/ReductionFields";
import { useReductionDraft } from "@/components/useReductionDraft";
import { type ReductionInput, type ReductionSheet, yearWords } from "@/services/hourReductions";

/**
 * A full-timer's first step of the preferences request: their hour reductions for the year.
 *
 * They declare their research reductions — SAFIR's, which the Head of Department then checks —
 * and read the department's own, which the Head of Department sets. The totals say what is
 * left to teach, which is what the timetable is then built around.
 */
export function ReductionsStep({
  sheet,
  busy,
  error,
  onSave,
  onSkip,
  next = "your preferences",
}: {
  sheet: ReductionSheet;
  busy: boolean;
  error: string;
  onSave: (items: Record<string, ReductionInput>, note: string) => void;
  /** On to the preferences without saving: the Head of Department's page shows them as not declared yet. */
  onSkip?: () => void;
  /** What comes after this step, for its button: "your preferences", or a course lead's course schedule. */
  next?: string;
}) {
  const { draft, set, total, owed, changes } = useReductionDraft(sheet.items, sheet.service);
  const [note, setNote] = useState(sheet.note);
  const research = sheet.items.filter((item) => item.group === "safir");
  const department = sheet.items.filter((item) => item.group === "department");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[#171717]">Your hour reductions for {yearWords(sheet.year)}</h2>
        <p className="mt-1 text-sm text-[#475467]">
          Your yearly service is <b className="text-[#171717]">{sheet.service} h</b> of teaching. Reductions take hours off
          it. This step has two parts:
        </p>
        {/* Whose each part is, said before either is shown, in each part's own colours
            (17 and 18 Nov 2026: the second was taken for the teacher's to fill in). */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PartCard
            owner="you"
            number={1}
            title="Your research reductions"
            words="The students you supervise, your research projects, an HDR. The Head of Department then checks them with SAFIR."
          />
          <PartCard
            owner="hod"
            number={2}
            title="Department reductions"
            words="Committees, heading a programme or the department, joining this year. Nothing for you to do: just check them."
          />
        </div>
      </div>

      <ReductionFields
        number={1}
        owner="you"
        title="Your research reductions (SAFIR)"
        about="Fill in what you have this year. The Head of Department then checks it with SAFIR."
        items={research}
        draft={draft}
        onChange={set}
        editable={() => true}
      />
      <ReductionFields
        number={2}
        owner="hod"
        title="Department reductions"
        about="The Head of Department sets these for each full-timer, and you can't change them. Just check them: if one is missing or wrong, say so in the note below."
        items={department}
        draft={draft}
        onChange={set}
        editable={() => false}
      />

      <label className="block text-sm font-semibold text-[#344054]">
        Note for the Head of Department <span className="font-normal text-[#667085]">(optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="For example: I coordinate a programme this year, and it isn't listed."
          className="mt-1.5 block w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal"
        />
      </label>

      <ReductionTotals total={total} owed={owed} service={sheet.service} />

      {error ? (
        <p role="alert" className="text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {onSkip ? (
          <button type="button" onClick={onSkip} className="text-sm font-semibold text-[#1f4e79] underline">
            Skip for now
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(changes((item) => item.group === "safir"), note)}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          Save and go on to {next}
        </button>
      </div>
    </div>
  );
}
