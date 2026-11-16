import { Loader2 } from "lucide-react";
import { useState } from "react";

import { ReductionFields, ReductionTotals } from "@/components/ReductionFields";
import { useReductionDraft } from "@/components/useReductionDraft";
import { type ReductionInput, type ReductionSheet, heldWords, yearWords } from "@/services/hourReductions";

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
}: {
  sheet: ReductionSheet;
  busy: boolean;
  error: string;
  onSave: (items: Record<string, ReductionInput>, note: string) => void;
  /** On to the preferences without saving: the Head of Department's page shows them as not declared yet. */
  onSkip?: () => void;
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
          Your yearly service is {sheet.service} h of teaching. Declare your research reductions; the department&rsquo;s are set
          by the Head of Department.
        </p>
      </div>

      <ReductionFields
        title="Research, through SAFIR"
        about="Yours to declare. The Head of Department checks them with SAFIR."
        items={research}
        draft={draft}
        onChange={set}
        editable={() => true}
      />
      <ReductionFields
        title="Set by the Head of Department"
        about="Something missing or wrong? Say so in the box below."
        items={department}
        draft={draft}
        onChange={set}
        editable={() => false}
      />

      <label className="block text-sm font-semibold text-[#344054]">
        For the Head of Department <span className="font-normal text-[#667085]">(optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={1000}
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
          Save and go on to your preferences
        </button>
      </div>
    </div>
  );
}

/** The year's reductions, to read: what each kind holds, and the two totals. */
export function ReductionsSummary({ sheet, onChange }: { sheet: ReductionSheet; onChange?: () => void }) {
  const held = sheet.items.filter((item) => item.hours > 0);
  return (
    <section className="rounded-lg border border-[#d0d5dd] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#171717]">Your hour reductions for {yearWords(sheet.year)}</h3>
        {onChange ? (
          <button type="button" onClick={onChange} className="text-xs font-semibold text-[#1f4e79] underline">
            Change
          </button>
        ) : null}
      </div>
      {held.length ? (
        <ul className="mt-1.5 space-y-0.5 text-sm text-[#344054]">
          {held.map((item) => (
            <li key={item.kind}>
              {item.label}: {heldWords(item)} · <b>{item.hours} h</b>
              {item.state === "declared" ? <span className="text-[#7a5410]"> (to be validated)</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-[#475467]">None.</p>
      )}
      <p className="mt-2 text-sm text-[#344054]">
        Reductions <b>{sheet.total} h</b> · teaching owed <b>{sheet.owed} h</b> of {sheet.service} h
      </p>
    </section>
  );
}
