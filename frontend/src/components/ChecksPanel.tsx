import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { clearCheck, fetchChecks, setCheck, type Check } from "@/services/portalLists";

/**
 * Which of the department's checks run, and the floor below which one says nothing.
 *
 * Not the rules beside it, and the difference is the point. A rule is authored — a field,
 * a comparison, some values — and a check is a named thing the code does; what a
 * coordinator decides about a check is whether it is worth being told about, and how big
 * a thing has to be before it is. So this is switches, not an editor.
 *
 * Saved on the spot rather than behind the dialog's Save, because a switch is one fact
 * with nothing to validate across rows, and a toggle that needs confirming reads as a
 * toggle that has not worked.
 *
 * The list comes from the server on every open, and it is the code's register of checks:
 * one deleted from the code stops appearing here even though its row survives, and one
 * added appears with its default before anybody has touched it.
 */
export function ChecksPanel({ cohortId = "", cohortName = "" }: { cohortId?: string; cohortName?: string }) {
  const client = useQueryClient();
  const checks = useQuery({ queryKey: ["checks", cohortId], queryFn: () => fetchChecks(cohortId) });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["checks"] });
    // Every verdict on every page is downstream of these, so they are asked again.
    void client.invalidateQueries({ queryKey: ["registration-check"] });
    void client.invalidateQueries({ queryKey: ["register-check"] });
  };
  const save = useMutation({
    mutationFn: (input: { name: string; enabled: boolean; threshold: number }) =>
      setCheck(input.name, { enabled: input.enabled, threshold: input.threshold, cohortId }),
    onSuccess: refresh,
  });
  const follow = useMutation({ mutationFn: (name: string) => clearCheck(name, cohortId), onSuccess: refresh });

  if (checks.isLoading) return <p className="text-sm text-[#667085]">Reading the checks…</p>;
  if (checks.error) {
    return <p role="alert" className="text-sm text-[#a6292f]">{(checks.error as Error).message}</p>;
  }

  return (
    <ul className="space-y-2" aria-label="Checks">
      {(checks.data ?? []).map((check) => (
        <CheckRow
          key={check.name}
          check={check}
          cohortName={cohortId ? cohortName : ""}
          busy={save.isPending || follow.isPending}
          onSave={(enabled, threshold) => save.mutate({ name: check.name, enabled, threshold })}
          onFollow={() => follow.mutate(check.name)}
        />
      ))}
      {(checks.data ?? []).length === 0 ? (
        <li className="text-sm text-[#667085]">No checks yet.</li>
      ) : null}
    </ul>
  );
}

function CheckRow({
  check,
  cohortName,
  busy,
  onSave,
  onFollow,
}: {
  check: Check;
  /** Set only when this panel is a cohort's, for the sentence about following along. */
  cohortName: string;
  busy: boolean;
  onSave: (enabled: boolean, threshold: number) => void;
  onFollow: () => void;
}) {
  const [floor, setFloor] = useState(String(check.threshold || ""));
  // A cohort answering the same as the department is following it, whether or not it has
  // a row of its own — so the offer to go back is shown only where it would change something.
  const own = check.enabled !== check.defaultEnabled || check.threshold !== check.defaultThreshold;

  return (
    <li className="rounded-md border border-[#e4e8ef] px-3 py-2">
      <label className="flex items-start gap-2 text-sm text-[#344054]">
        <input
          type="checkbox"
          aria-label={check.title}
          checked={check.enabled}
          disabled={busy}
          onChange={(event) => onSave(event.target.checked, Number(floor || 0))}
          className="mt-1"
        />
        <span className="min-w-0 flex-1">{check.title}</span>
      </label>

      {check.measures ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs text-[#667085]">
          Say nothing below
          <input
            aria-label={`Fewest ${check.measures} worth a warning, for ${check.title}`}
            value={floor}
            inputMode="numeric"
            disabled={!check.enabled || busy}
            onChange={(event) => setFloor(event.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => Number(floor || 0) !== check.threshold && onSave(check.enabled, Number(floor || 0))}
            placeholder="0"
            className="w-16 rounded border border-[#cbd5e1] px-2 py-1 tabular-nums disabled:bg-[#f8fafc]"
          />
          {check.measures}
        </p>
      ) : null}

      {cohortName && own ? (
        <p className="mt-1 pl-6 text-xs text-[#98a2b3]">
          {cohortName}&apos;s own answer.{" "}
          <button type="button" disabled={busy} onClick={onFollow} className="font-semibold text-[#1f4e79] underline">
            Follow the department again
          </button>
        </p>
      ) : null}
    </li>
  );
}
