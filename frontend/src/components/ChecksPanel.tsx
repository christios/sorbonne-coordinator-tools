import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchChecks, setCheck, type Check, type CheckHome } from "@/services/portalLists";

/**
 * Which of the department's checks run, and the floor below which one says nothing.
 *
 * Not the rules beside it, and the difference is the point. A rule is authored — a field,
 * a comparison, some values — and a check is a named thing the code does; what a
 * coordinator decides about a check is whether it is worth being told about, and how big
 * a thing has to be before it is. So this is switches, not an editor.
 *
 * One place, in Settings, and an administrator's to change. It used to open from three
 * pages, each listing the whole register — a teacher's hours on Cohorts, a student's
 * timetable on Teacher hours — and any coordinator could switch a warning off for the whole
 * department from any of them. Everybody can still read it: a coordinator who is not told
 * why something is quiet will assume it is broken.
 *
 * Grouped by the page each check speaks on, because that is how an administrator thinks
 * about them — "what does Teacher hours warn about" — and because a title alone does not
 * say where the warning it governs will appear.
 *
 * Saved on the spot, because a switch is one fact with nothing to validate across rows,
 * and a toggle that needs confirming reads as a toggle that has not worked.
 *
 * The list comes from the server on every open, and it is the code's register of checks:
 * one deleted from the code stops appearing here even though its row survives, and one
 * added appears with its default before anybody has touched it.
 */

const WHERE: { home: CheckHome; label: string }[] = [
  { home: "cohorts", label: "Cohorts" },
  { home: "teacher-hours", label: "Teacher hours" },
  { home: "settings", label: "Every student page" },
];

export function ChecksPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const checks = useQuery({ queryKey: ["checks", ""], queryFn: () => fetchChecks("") });

  const save = useMutation({
    mutationFn: (input: { name: string; enabled: boolean; threshold: number }) =>
      setCheck(input.name, { enabled: input.enabled, threshold: input.threshold }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["checks"] });
      // Every verdict on every page is downstream of these, so they are asked again.
      void client.invalidateQueries({ queryKey: ["registration-check"] });
      void client.invalidateQueries({ queryKey: ["register-check"] });
    },
  });

  if (checks.isLoading) return <p className="text-sm text-[#667085]">Reading the checks…</p>;
  if (checks.error) {
    return <p role="alert" className="text-sm text-[#a6292f]">{(checks.error as Error).message}</p>;
  }
  const all = checks.data ?? [];
  if (!all.length) return <p className="text-sm text-[#667085]">No checks yet.</p>;

  return (
    <div className="space-y-5">
      {canChange ? null : (
        <p className="rounded-md border border-[#e4e8ef] bg-[#f8fafc] px-3 py-2 text-sm text-[#667085]">
          Only an administrator can change these. They are shown so you can see why a warning does or does not appear.
        </p>
      )}
      {save.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(save.error as Error).message}</p>
      ) : null}
      {WHERE.map(({ home, label }) => {
        const here = all.filter((check) => check.home === home);
        if (!here.length) return null;
        return (
          <section key={home}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">{label}</h4>
            <ul className="space-y-2" aria-label={`Checks on ${label}`}>
              {here.map((check) => (
                <CheckRow
                  key={check.name}
                  check={check}
                  locked={!canChange || save.isPending}
                  onSave={(enabled, threshold) => save.mutate({ name: check.name, enabled, threshold })}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CheckRow({
  check,
  locked,
  onSave,
}: {
  check: Check;
  locked: boolean;
  onSave: (enabled: boolean, threshold: number) => void;
}) {
  const [floor, setFloor] = useState(String(check.threshold || ""));

  return (
    <li className="rounded-md border border-[#e4e8ef] px-3 py-2">
      <label className="flex items-start gap-2 text-sm text-[#344054]">
        <input
          type="checkbox"
          aria-label={check.title}
          checked={check.enabled}
          disabled={locked}
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
            disabled={!check.enabled || locked}
            onChange={(event) => setFloor(event.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => Number(floor || 0) !== check.threshold && onSave(check.enabled, Number(floor || 0))}
            placeholder="0"
            className="w-16 rounded border border-[#cbd5e1] px-2 py-1 tabular-nums disabled:bg-[#f8fafc]"
          />
          {check.measures}
        </p>
      ) : null}
    </li>
  );
}
