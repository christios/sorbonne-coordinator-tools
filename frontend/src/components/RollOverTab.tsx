import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarArrowUp, Check } from "lucide-react";
import { useMemo, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import { afterPlacement } from "@/services/afterPlacement";
import { fetchTermLinks } from "@/services/portalLists";
import { semesterShown, useSemesterYears } from "@/services/semesterYears";
import { fetchCourseCards, rollOverCohort, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * The Semesters tab of a cohort's settings: the cohort's semesters, and rolling it over.
 *
 * A cohort is a year's — L1, 2026-27 — and holds its students and its sets semester by
 * semester. The tab lists each semester of its year with what L1 holds there, and carries
 * one semester's students into another: L1's Semester 1 into its Semester 2. Nobody
 * leaves Semester 1, and their groups there stay. Rolling over again only adds whoever has
 * joined since; a student already in another cohort that semester is left there, and named.
 */
export function RollOverTab({
  cohort,
  onDone,
}: {
  cohort: Cohort;
  /** Afterwards, to show the cohort in the semester rolled into. */
  onDone?: (semesterId: string, cohortId: string) => void;
}) {
  const client = useQueryClient();
  const yearOf = useSemesterYears();
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const linksRead = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const cards = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, retry: false });
  const links = useMemo(() => linksRead.data ?? {}, [linksRead.data]);
  const counts = useMemo(() => cohort.memberCounts ?? {}, [cohort.memberCounts]);

  const nameOf = (term: { id: string; name: string }) => {
    const shown = semesterShown(term.name, yearOf(term));
    return [shown.label, shown.year].filter(Boolean).join(" ");
  };
  // Its sets in each semester, from the Groups & CRNs reading every page shares.
  const setsIn = (termId: string) =>
    (cards.data ?? []).find((held) => held.cohort.id === cohort.id)?.scopes.filter((scope) => scope.termId === termId).length ?? 0;

  /*
   * Its semesters: those of its year, and any it holds students or sets in. In the order the
   * portal numbers them (262710 before 262720), so "the next one" means the next.
   */
  const semesters = useMemo(
    () =>
      (terms.data ?? [])
        .filter(
          (term) =>
            (counts[term.id] ?? 0) > 0 ||
            setsIn(term.id) > 0 ||
            (cohort.term.trim() !== "" && yearOf(term) === cohort.term.trim()),
        )
        .sort((left, right) => (links[left.id] ?? "~").localeCompare(links[right.id] ?? "~") || left.name.localeCompare(right.name)),
    // `yearOf` and `setsIn` read `links` and `cards`, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terms.data, links, cards.data, cohort, counts],
  );

  // From the first semester that holds students; into the one after it.
  const withStudents = semesters.filter((term) => (counts[term.id] ?? 0) > 0);
  const [fromId, setFromId] = useState("");
  const [intoId, setIntoId] = useState("");
  const from = withStudents.find((term) => term.id === fromId) ?? withStudents[0] ?? null;
  const intoOptions = semesters.filter((term) => term.id !== from?.id);
  const after = from ? semesters.slice(semesters.findIndex((term) => term.id === from.id) + 1) : [];
  const into = intoOptions.find((term) => term.id === intoId) ?? after[0] ?? intoOptions[0] ?? null;

  const roll = useMutation({
    mutationFn: () => rollOverCohort(cohort.id, from?.id ?? "", into?.id ?? ""),
    onSuccess: () => {
      afterPlacement(client);
      client.invalidateQueries({ queryKey: ["course-cards"] });
    },
  });

  const count = (n: number) => `${n} student${n === 1 ? "" : "s"}`;
  const sets = (n: number) => `${n} set${n === 1 ? "" : "s"}`;

  if (terms.isLoading || linksRead.isLoading) return <p className="text-sm text-[#667085]">Reading the semesters…</p>;

  return (
    <div className="space-y-5">
      {/* Its semesters, each with what it holds there. */}
      <section aria-label={`${cohort.name}'s semesters`} className="rounded-md border border-[#d3d9e2]">
        <h3 className="border-b border-[#eef1f5] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">
          {cohort.name}
          {cohort.term ? <span className="ml-1.5 font-normal normal-case text-[#98a2b3]">{cohort.term}</span> : null}
        </h3>
        {semesters.length ? (
          <ul className="divide-y divide-[#f2f4f7]">
            {semesters.map((term) => (
              <li key={term.id} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-semibold text-[#344054]">{nameOf(term)}</span>
                <span className="text-xs tabular-nums text-[#667085]">
                  {count(counts[term.id] ?? 0)} · {sets(setsIn(term.id))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-[#667085]">
            No semester of {cohort.term || "its year"} yet. Say its year on the Cohort tab.
          </p>
        )}
      </section>

      {roll.data ? (
        <div className="space-y-3">
          <p className="rounded-md border border-[#d7e3d4] bg-[#f3f8f1] px-3 py-2 text-sm text-[#2f5d2a]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Check size={14} aria-hidden="true" />
              {count(roll.data.added)} added
            </span>{" "}
            to {cohort.name} in {into ? nameOf(into) : "that semester"}.
            {roll.data.skipped.length ? (
              <span className="mt-1 block text-[#8a6116]">
                {roll.data.skipped.length} already in another cohort there — left where they are:{" "}
                <span className="font-mono text-xs">{roll.data.skipped.join(", ")}</span>
              </span>
            ) : null}
          </p>
          {onDone && into ? (
            <button
              type="button"
              onClick={() => onDone(into.id, cohort.id)}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white"
            >
              Show {cohort.name} in {nameOf(into)}
            </button>
          ) : null}
        </div>
      ) : !from ? (
        <p className="text-sm text-[#667085]">{cohort.name} holds no students yet, so there is nobody to roll over.</p>
      ) : !into ? (
        <p className="text-sm text-[#667085]">
          {cohort.name} has no other semester to roll its students into. Say its year on the Cohort tab.
        </p>
      ) : (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#667085]">Roll over</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#344054]">
            <div className="w-fit min-w-[12rem] max-w-full">
              <SelectMenu
                label="From"
                value={from.id}
                onChange={setFromId}
                options={withStudents.map((term) => ({ value: term.id, ...semesterShown(term.name, yearOf(term)), badge: String(counts[term.id] ?? 0) }))}
              />
            </div>
            <span aria-hidden="true">→</span>
            <div className="w-fit min-w-[12rem] max-w-full">
              <SelectMenu
                label="Into"
                value={into.id}
                onChange={setIntoId}
                options={intoOptions.map((term) => ({ value: term.id, ...semesterShown(term.name, yearOf(term)), badge: String(counts[term.id] ?? 0) }))}
              />
            </div>
          </div>
          <p className="text-xs text-[#667085]">
            {(counts[into.id] ?? 0) > 0
              ? `${cohort.name} already holds ${count(counts[into.id] ?? 0)} in ${nameOf(into)}: this adds whoever of its ${count(counts[from.id] ?? 0)} in ${nameOf(from)} is not there yet.`
              : `Copies ${cohort.name}'s ${count(counts[from.id] ?? 0)} in ${nameOf(from)} into ${nameOf(into)}.`}{" "}
            Nobody leaves {nameOf(from)}, and their groups there stay. A student already in another cohort in{" "}
            {nameOf(into)} is left there, and named.
          </p>
          <button
            type="button"
            disabled={roll.isPending}
            onClick={() => roll.mutate()}
            className="inline-flex items-center gap-2 rounded-md border border-[#1f4e79] bg-white px-4 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:border-[#b7bec8] disabled:text-[#9ba8b5]"
          >
            <CalendarArrowUp size={15} aria-hidden="true" />
            {roll.isPending ? "Rolling over…" : `Roll over into ${nameOf(into)}`}
          </button>
          {roll.error ? (
            <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
              {(roll.error as Error).message}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
