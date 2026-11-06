import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarArrowUp, Check } from "lucide-react";
import { useMemo, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import { afterPlacement } from "@/services/afterPlacement";
import { nextSemesterName } from "@/services/rollOver";
import { fetchTermLinks } from "@/services/portalLists";
import { semesterShown, useSemesterYears } from "@/services/semesterYears";
import { fetchCohorts, rollOverCohort, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * The Roll over tab of a cohort's settings: this cohort carried into a later semester.
 *
 * L1-S1 gets its L1-S2 — the same majors, year level, allowed courses, Teams channels and
 * rules, and every one of its students. Nobody leaves L1-S1: a student is in one cohort per
 * semester, so they are in both, and keep the groups they sit in now. Rolling over again
 * only adds whoever has joined since. An L1-S2 somebody already made by hand is linked and
 * filled rather than made a second time.
 */
export function RollOverTab({
  cohort,
  onDone,
}: {
  cohort: Cohort;
  /** Afterwards, to show the cohort rolled into: its semester, and the cohort. */
  onDone?: (semesterId: string, cohortId: string) => void;
}) {
  const client = useQueryClient();
  const yearOf = useSemesterYears();
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const linksRead = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const links = useMemo(() => linksRead.data ?? {}, [linksRead.data]);

  // Its semester is its portal term — the latest, for a cohort that names more than one.
  const own = [...cohort.terms].sort().pop() ?? "";
  // A LATER semester linked to a portal term, the next one first: 262710 → 262720.
  const targets = useMemo(
    () =>
      (terms.data ?? [])
        .filter((term) => own && links[term.id] && links[term.id] > own)
        .sort((left, right) => links[left.id].localeCompare(links[right.id])),
    [terms.data, links, own],
  );
  const [targetId, setTargetId] = useState("");
  const target = targets.find((term) => term.id === targetId) ?? targets[0] ?? null;
  const code = target ? links[target.id] : "";

  // The one it made before, or one made by hand under the name it would make — the server
  // takes that rather than making a second L1-S2.
  const next = nextSemesterName(cohort.name, code);
  const ofTerm = (cohorts.data ?? []).filter((candidate) => candidate.id !== cohort.id && candidate.terms.includes(code));
  const existing =
    ofTerm.find((candidate) => candidate.follows === cohort.id) ??
    ofTerm.find((candidate) => !candidate.follows && candidate.name.trim().toLowerCase() === next.toLowerCase()) ??
    null;
  const name = existing?.name ?? next;
  const students = `${cohort.memberCount} student${cohort.memberCount === 1 ? "" : "s"}`;

  const roll = useMutation({
    mutationFn: () => rollOverCohort(cohort.id, code),
    onSuccess: () => {
      afterPlacement(client);
      client.invalidateQueries({ queryKey: ["discrepancy-rules"] });
      client.invalidateQueries({ queryKey: ["course-cards"] });
    },
  });

  const shown = target ? semesterShown(target.name, yearOf(target)) : null;
  const targetName = shown ? [shown.label, shown.year].filter(Boolean).join(" ") : "";

  /*
   * The link, read from both ends: L1-S2's settings say it was rolled over from L1-S1, and
   * L1-S1's say it was rolled into L1-S2. Only the second cohort holds the link, so the
   * first finds it by looking for whoever names it.
   */
  const all = cohorts.data ?? [];
  const from = cohort.follows ? (all.find((candidate) => candidate.id === cohort.follows) ?? null) : null;
  const into = all.filter((candidate) => candidate.follows === cohort.id);
  const semesterOf = (held: Cohort) => {
    const term = (terms.data ?? []).find((candidate) => links[candidate.id] && held.terms.includes(links[candidate.id]));
    if (!term) return held.terms.join(", ");
    const named = semesterShown(term.name, yearOf(term));
    return [named.label, named.year].filter(Boolean).join(" ");
  };
  const count = (held: Cohort) => `${held.memberCount} student${held.memberCount === 1 ? "" : "s"}`;
  // From the second cohort's side, the same roll-over run again: whoever joined L1-S1 since.
  const refresh = useMutation({
    mutationFn: () => rollOverCohort(from?.id ?? "", own),
    onSuccess: () => {
      afterPlacement(client);
      client.invalidateQueries({ queryKey: ["course-cards"] });
    },
  });

  const linked =
    from || into.length ? (
      <section aria-label="Linked cohorts" className="rounded-md border border-[#d3d9e2] bg-[#f8fafc] px-4 py-3 text-sm text-[#344054]">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#667085]">Linked</h3>
        {from ? (
          <div className="mt-2">
            <p>
              Rolled over from <span className="font-semibold text-[#1f4e79]">{from.name}</span>
              <span className="text-[#667085]">
                {" "}
                · {semesterOf(from)} · {count(from)}
              </span>
            </p>
            {refresh.data ? (
              <p className="mt-1.5 text-xs text-[#2f5d2a]">
                {refresh.data.added
                  ? `${refresh.data.added} student${refresh.data.added === 1 ? "" : "s"} from ${from.name} added.`
                  : `Nobody new: every student of ${from.name} is here already.`}
                {refresh.data.skipped.length ? (
                  <span className="block text-[#8a6116]">
                    {refresh.data.skipped.length} in another cohort of this semester, left where they are:{" "}
                    <span className="font-mono">{refresh.data.skipped.join(", ")}</span>
                  </span>
                ) : null}
              </p>
            ) : (
              <button
                type="button"
                disabled={refresh.isPending || !own}
                onClick={() => refresh.mutate()}
                className="mt-1.5 text-xs font-semibold text-[#1f4e79] underline decoration-[#b7c9dc] underline-offset-2 hover:decoration-[#1f4e79] disabled:text-[#9ba8b5]"
              >
                {refresh.isPending ? "Bringing them in…" : `Bring in whoever has joined ${from.name} since`}
              </button>
            )}
            {refresh.error ? (
              <p role="alert" className="mt-1.5 text-xs text-[#a6292f]">
                {(refresh.error as Error).message}
              </p>
            ) : null}
          </div>
        ) : null}
        {into.map((held) => (
          <p key={held.id} className="mt-2">
            Rolled over into <span className="font-semibold text-[#1f4e79]">{held.name}</span>
            <span className="text-[#667085]">
              {" "}
              · {semesterOf(held)} · {count(held)}
            </span>
          </p>
        ))}
      </section>
    ) : null;

  return (
    <div className="space-y-5">
      {linked}
      {rollingOver()}
    </div>
  );

  /** Rolling it over into a later semester, or why it cannot be. */
  function rollingOver() {
    if (roll.data) {
      const result = roll.data;
      return (
        <div className="space-y-3">
          <p className="rounded-md border border-[#d7e3d4] bg-[#f3f8f1] px-3 py-2 text-sm text-[#2f5d2a]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Check size={14} aria-hidden="true" />
              {result.cohort.name}
            </span>{" "}
            continues {cohort.name}: {result.added} student{result.added === 1 ? "" : "s"} added.
            {result.skipped.length ? (
              <span className="mt-1 block text-[#8a6116]">
                {result.skipped.length} already in another cohort of {targetName || "that semester"} — left where they are:{" "}
                <span className="font-mono text-xs">{result.skipped.join(", ")}</span>
              </span>
            ) : null}
          </p>
          {onDone && target ? (
            <button
              type="button"
              onClick={() => onDone(target.id, result.cohort.id)}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white"
            >
              Show {result.cohort.name}
            </button>
          ) : null}
        </div>
      );
    }

    if (!own) {
      return (
        <p className="text-sm text-[#667085]">
          {cohort.name} names no portal term, so there is no semester to roll it over from. Give it its term on the Cohort tab
          first.
        </p>
      );
    }
    if (terms.isLoading || linksRead.isLoading) return <p className="text-sm text-[#667085]">Reading the semesters…</p>;
    if (!targets.length) {
      return (
        <p className="text-sm text-[#667085]">
          No semester after {own} is linked to a portal term yet, so there is nowhere to roll {cohort.name} over to.
        </p>
      );
    }

    return (
      <div className="space-y-4">
        <div className="w-fit min-w-[12rem] max-w-full">
          <SelectMenu
            label="Into"
            value={target?.id ?? ""}
            onChange={setTargetId}
            placeholder="Which semester…"
            options={targets.map((term) => ({
              value: term.id,
              ...semesterShown(term.name, yearOf(term)),
            }))}
          />
        </div>

        {target ? (
          <div className="rounded-md border border-[#d3d9e2] px-4 py-3 text-sm text-[#344054]">
            <p>
              <span className="font-semibold">{cohort.name}</span> → <span className="font-semibold text-[#1f4e79]">{name}</span>
            </p>
            <p className="mt-1 text-xs text-[#667085]">
              {existing && existing.follows !== cohort.id
                ? `${existing.name} was made by hand: it is linked to ${cohort.name}, keeps its own settings, and takes its ${students}.`
                : existing
                  ? `${existing.name} is already there: adds whoever of its ${students} is not in it yet.`
                  : `A new cohort with ${cohort.name}'s settings and rules, and its ${students}.`}
            </p>
          </div>
        ) : null}

        <p className="text-xs text-[#98a2b3]">
          Nobody leaves {cohort.name}, and their groups in it stay. A student already in another cohort of{" "}
          {targetName || "that semester"} is left where they are and named afterwards. The sets of groups are not copied: each
          semester has its own, on the Group schema page.
        </p>

        <button
          type="button"
          disabled={!target || roll.isPending}
          onClick={() => roll.mutate()}
          className="inline-flex items-center gap-2 rounded-md border border-[#1f4e79] bg-white px-4 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:border-[#b7bec8] disabled:text-[#9ba8b5]"
        >
          <CalendarArrowUp size={15} aria-hidden="true" />
          {roll.isPending ? "Rolling over…" : `Roll over into ${name}`}
        </button>
        {roll.error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {(roll.error as Error).message}
          </p>
        ) : null}
      </div>
    );
  }
}
