/**
 * Who writes the course learning outcomes: the department's one switch (November 2026 review).
 *
 * Switching hides one set of outcomes and shows the other; nothing is deleted. But the CLOs a
 * teacher picked on each graded activity were picked from the set in use, so the dialog says
 * so before anything changes.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { describeAge } from "@/services/rosterStore";
import { OUTCOME_MODE_KEY, fetchOutcomeMode, setOutcomeMode, type OutcomeMode } from "@/services/syllabusOutcomeMode";

const CHOICES: Array<{ mode: OutcomeMode; label: string; explanation: string }> = [
  {
    mode: "teacher",
    label: "Teachers",
    explanation:
      "Each syllabus writes its own course learning outcomes and aligns them to the PLOs the curriculum mapping expects of the course.",
  },
  {
    mode: "hod",
    label: "Head of Department",
    explanation:
      "Each course's outcomes and their alignment are written once, in Manage catalogues → Curriculum mapping. Syllabi show them and cannot change them.",
  },
];

export function OutcomeModePanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const setting = useQuery({ queryKey: OUTCOME_MODE_KEY, queryFn: fetchOutcomeMode, retry: false });
  const [pending, setPending] = useState<OutcomeMode | null>(null);
  const save = useMutation({
    mutationFn: (mode: OutcomeMode) => setOutcomeMode(mode),
    onSuccess: (saved) => {
      client.setQueryData(OUTCOME_MODE_KEY, saved);
      setPending(null);
    },
  });
  const current = setting.data?.mode ?? "teacher";
  const set = setting.data?.updatedAt ? Date.parse(setting.data.updatedAt) : Number.NaN;
  const chosen = CHOICES.find((choice) => choice.mode === pending);

  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="sr-only">Who writes course learning outcomes</legend>
        {CHOICES.map((choice) => (
          <label key={choice.mode} className="flex cursor-pointer items-start gap-3 rounded-md border border-[#d9dee7] bg-white p-3 has-[:checked]:border-[#1f4e79] has-[:checked]:bg-[#f2f7fb] has-[:disabled]:cursor-default">
            <input
              type="radio"
              name="outcome-mode"
              value={choice.mode}
              checked={current === choice.mode}
              disabled={!canChange || save.isPending || setting.isPending}
              onChange={() => setPending(choice.mode)}
              className="mt-1 h-4 w-4 text-[#1f4e79] focus:ring-[#d7e5f3]"
            />
            <span>
              <span className="block text-sm font-semibold text-[#344054]">{choice.label}</span>
              <span className="mt-0.5 block text-sm text-[#667085]">{choice.explanation}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-[#667085]">
        {setting.data?.updatedBy && !Number.isNaN(set)
          ? `Set by ${setting.data.updatedByName || setting.data.updatedBy}, ${describeAge(set, Date.now())}.`
          : setting.data
            ? "Nobody has chosen yet, so teachers write their own outcomes."
            : ""}
        {canChange ? "" : " Only an administrator of the syllabus builder can change it."}
      </p>
      {save.error ? (
        <p role="alert" className="text-sm text-[#8f1f25]">
          {(save.error as Error).message}
        </p>
      ) : null}
      <ConfirmDialog
        open={Boolean(chosen)}
        title={chosen?.mode === "hod" ? "Hand the course learning outcomes to the Head of Department?" : "Let teachers write their own course learning outcomes?"}
        description="Every syllabus switches at once. Nothing is deleted: the other set of outcomes is kept and comes back if you switch again. But the outcomes picked on each graded activity were picked from the set in use, so teachers will need to pick them again."
        confirmLabel={save.isPending ? "Saving…" : "Switch"}
        onClose={() => setPending(null)}
        onConfirm={() => pending && save.mutate(pending)}
      />
    </div>
  );
}
