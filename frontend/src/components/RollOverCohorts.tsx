import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarArrowUp, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { afterPlacement } from "@/services/afterPlacement";
import { semesterShown, useSemesterYears } from "@/services/semesterYears";
import { rollOverCohort, type Cohort, type RollOver } from "@/services/studentDatabase";

type Semester = { id: string; name: string };

/**
 * What a rolled-over cohort will be called: L1-S1 continues as L1-S2.
 *
 * The server's own rule, said here so the dialog can show the name before anything is made.
 * A name that ends in no semester number takes the portal term instead.
 */
export function nextSemesterName(name: string, termCode: string): string {
  const found = /S(\d+)$/.exec(name);
  if (found) return `${name.slice(0, found.index)}S${Number(found[1]) + 1}`;
  return `${name} (${termCode})`;
}

/**
 * Carrying a semester's cohorts into the next semester of the year.
 *
 * Each cohort ticked gets its next-semester cohort — L1-S1's L1-S2 — with the same majors,
 * year level, allowed courses, Teams channels and rules, and every one of its students.
 * Nobody leaves the cohort they are in: a student is in one cohort per semester, so they
 * are in both, and keep the groups they sit in now. Rolling over again only adds whoever
 * has joined since.
 */
export function RollOverCohorts({
  from,
  fromTerm,
  fromCohorts,
  cohorts,
  semesters,
  links,
  onDone,
}: {
  /** The semester on screen, and the portal term it is linked to. */
  from: Semester;
  fromTerm: string;
  /** Its cohorts — the ones that can be rolled over. */
  fromCohorts: Cohort[];
  /** Every cohort, to find one that already continues a cohort into the chosen semester. */
  cohorts: Cohort[];
  semesters: Semester[];
  links: Record<string, string>;
  /** Afterwards: the semester rolled into, and the first cohort made or added to there. */
  onDone: (semesterId: string, cohortId: string) => void;
}) {
  const client = useQueryClient();
  const yearOf = useSemesterYears();
  const [open, setOpen] = useState(false);

  // Into a LATER semester linked to a portal term — a cohort's semester is its term — the
  // next one first: 262710 → 262720.
  const targets = useMemo(
    () =>
      semesters
        .filter((term) => links[term.id] && links[term.id] > fromTerm)
        .sort((left, right) => links[left.id].localeCompare(links[right.id])),
    [semesters, links, fromTerm],
  );
  const following = targets[0] ?? null;
  const [targetId, setTargetId] = useState("");
  const target = targets.find((term) => term.id === targetId) ?? following;
  const code = target ? links[target.id] : "";

  /** Per cohort: what it would become, and whether it can go at all. */
  const plan = useMemo(
    () =>
      fromCohorts.map((cohort) => {
        const already = cohort.terms.includes(code);
        const next = nextSemesterName(cohort.name, code);
        // The one it made before, or one made by hand under that name — the server takes it
        // rather than making a second L1-S2.
        const ofTerm = cohorts.filter((candidate) => candidate.id !== cohort.id && candidate.terms.includes(code));
        const existing =
          ofTerm.find((candidate) => candidate.follows === cohort.id) ??
          ofTerm.find((candidate) => !candidate.follows && candidate.name.trim().toLowerCase() === next.toLowerCase()) ??
          null;
        return { cohort, already, existing, name: existing?.name ?? next };
      }),
    [fromCohorts, cohorts, code],
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    setTargetId("");
    setTicked(new Set(fromCohorts.map((cohort) => cohort.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const chosen = plan.filter((entry) => ticked.has(entry.cohort.id) && !entry.already);

  const [done, setDone] = useState<{ from: Cohort; result: RollOver }[] | null>(null);
  const roll = useMutation({
    mutationFn: async () => {
      // One at a time, in the order shown, so a failure part-way says which.
      const out: { from: Cohort; result: RollOver }[] = [];
      for (const entry of chosen) out.push({ from: entry.cohort, result: await rollOverCohort(entry.cohort.id, code) });
      return out;
    },
    onSuccess: (out) => {
      setDone(out);
      afterPlacement(client);
      client.invalidateQueries({ queryKey: ["discrepancy-rules"] });
      client.invalidateQueries({ queryKey: ["course-cards"] });
    },
  });

  const close = () => {
    setOpen(false);
    if (done?.length && target) onDone(target.id, done[0].result.cohort.id);
    setDone(null);
    roll.reset();
  };

  const targetLabel = target ? semesterShown(target.name, yearOf(target)) : null;
  const targetName = targetLabel ? [targetLabel.label, targetLabel.year].filter(Boolean).join(" ") : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!fromCohorts.length}
        title={
          fromCohorts.length
            ? "Give this semester's cohorts their next-semester cohort, with the same settings and students"
            : "This semester has no cohort to roll over"
        }
        className="inline-flex h-10 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:text-[#9ba8b5] disabled:hover:bg-white"
      >
        <CalendarArrowUp size={16} aria-hidden="true" />
        Roll over
      </button>

      <Modal
        open={open}
        title={done ? "Rolled over" : "Roll over to the next semester"}
        description={
          done
            ? undefined
            : `Each cohort ticked gets a cohort for the semester chosen, with the same settings and rules and every one of its students. Nobody leaves ${from.name}'s cohorts, and their groups there stay.`
        }
        onClose={close}
        footer={
          <div className="flex items-center justify-end gap-3">
            {done ? (
              <button type="button" onClick={close} className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white">
                {target ? `Show ${targetName}` : "Done"}
              </button>
            ) : (
              <>
                <button type="button" onClick={close} className="text-sm font-semibold text-[#667085]">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!target || !chosen.length || roll.isPending}
                  onClick={() => roll.mutate()}
                  className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
                >
                  {roll.isPending ? "Rolling over…" : `Roll over ${chosen.length} cohort${chosen.length === 1 ? "" : "s"}`}
                </button>
              </>
            )}
          </div>
        }
      >
        {done ? (
          <ul className="space-y-2" aria-label="What was rolled over">
            {done.map(({ from: source, result }) => (
              <li key={source.id} className="rounded-md border border-[#d7e3d4] bg-[#f3f8f1] px-3 py-2 text-sm text-[#2f5d2a]">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Check size={14} aria-hidden="true" />
                  {result.cohort.name}
                </span>{" "}
                continues {source.name}: {result.added} student{result.added === 1 ? "" : "s"} added.
                {result.skipped.length ? (
                  <span className="mt-1 block text-[#8a6116]">
                    {result.skipped.length} already in another cohort of {targetName || "that semester"} — left where they are:{" "}
                    <span className="font-mono text-xs">{result.skipped.join(", ")}</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : targets.length === 0 ? (
          <p className="text-sm text-[#667085]">
            No later semester is linked to a portal term yet, so there is nowhere to roll {from.name}&rsquo;s cohorts over to.
          </p>
        ) : (
          <>
            <div className="w-fit min-w-[12rem] max-w-full">
              <SelectMenu
                label="Into"
                value={target?.id ?? ""}
                onChange={setTargetId}
                options={targets.map((term) => ({
                  value: term.id,
                  ...semesterShown(term.name, yearOf(term)),
                  badge: links[term.id],
                  badgeTone: "muted" as const,
                }))}
              />
            </div>

            <ul className="mt-4 divide-y divide-[#eef1f5] rounded-md border border-[#d3d9e2]" aria-label="Cohorts to roll over">
              {plan.map(({ cohort, already, existing, name }) => (
                <li key={cohort.id}>
                  <label
                    className={`flex items-start gap-3 px-3 py-2.5 text-sm ${already ? "text-[#98a2b3]" : "cursor-pointer text-[#344054] hover:bg-[#f8fafc]"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={already}
                      checked={!already && ticked.has(cohort.id)}
                      onChange={() =>
                        setTicked((current) => {
                          const next = new Set(current);
                          if (next.has(cohort.id)) next.delete(cohort.id);
                          else next.add(cohort.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">{cohort.name}</span>
                      {already ? null : (
                        <>
                          {" "}
                          → <span className="font-semibold text-[#1f4e79]">{name}</span>
                        </>
                      )}
                      <span className="block text-xs text-[#667085]">
                        {already
                          ? `Already a cohort of ${code}.`
                          : existing && existing.follows !== cohort.id
                            ? `${existing.name} was made by hand: it is linked to ${cohort.name}, keeps its own settings, and takes its ${cohort.memberCount} student${cohort.memberCount === 1 ? "" : "s"}.`
                            : existing
                            ? `${existing.name} is already there: adds whoever of its ${cohort.memberCount} student${cohort.memberCount === 1 ? "" : "s"} is not in it yet.`
                            : `${cohort.memberCount} student${cohort.memberCount === 1 ? "" : "s"}, its settings and its rules.`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[#98a2b3]">
              A student already in another cohort of {targetName || "that semester"} is left where they are and named afterwards.
              The sets of groups are not copied: each semester has its own, on the Group schema page.
            </p>
            {roll.error ? (
              <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
                {(roll.error as Error).message}
              </p>
            ) : null}
          </>
        )}
      </Modal>
    </>
  );
}
