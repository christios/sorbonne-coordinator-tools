import { useQuery } from "@tanstack/react-query";
import { Layers, ListTree, Users } from "lucide-react";
import { useState } from "react";

import { CohortList } from "@/components/CohortList";
import { GroupCatalogue } from "@/components/GroupCatalogue";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { SidePane } from "@/components/SidePane";
import { fetchCohorts, type Cohort } from "@/services/studentDatabase";

const PAGES = [
  { id: "students", name: "Students", icon: Users },
  { id: "cohorts", name: "Cohorts", icon: Layers },
  { id: "groups", name: "Groups & CRNs", icon: ListTree },
] as const;

type PageId = (typeof PAGES)[number]["id"];

const TITLES: Record<PageId, { title: string; blurb: string }> = {
  students: {
    title: "Students",
    blurb: "Pull the roster from the registrar portal, and see who stayed, left or changed.",
  },
  cohorts: {
    title: "Cohorts",
    blurb: "Assemble students into the groups they will be taught in.",
  },
  groups: {
    title: "Groups & CRNs",
    blurb: "What each group stands for: one CRN per course in the block.",
  },
};

/**
 * The coordinator's Student Database.
 *
 * It keeps student ids, the cohorts they belong to, and the groups those cohorts assign
 * them into. It holds no names and no timetable: names arrive from the registrar
 * extension and stay in the browser, and the student-facing timetable is a separate
 * application with its own upload.
 */
export function StudentDatabase() {
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts });
  const [page, setPage] = useState<PageId>("students");
  const [cohortId, setCohortId] = useState("");

  const available = cohorts.data ?? [];
  const cohort = available.find((candidate) => candidate.id === cohortId) ?? available[0] ?? null;
  const needsCohort = page === "groups";

  const openGroups = (chosen: Cohort) => {
    setCohortId(chosen.id);
    setPage("groups");
  };

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)]">
      <SidePane
        label="Student database pages"
        heading="Student database"
        items={PAGES.map(({ id, name, icon }) => ({ id, name, icon }))}
        activeId={page}
        onSelect={(id) => setPage(id as PageId)}
      />

      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-[86rem] px-4 py-6 sm:px-6">
          <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
            <div>
              <h2 className="text-2xl font-semibold text-[#171717]">{TITLES[page].title}</h2>
              <p className="mt-1 text-sm text-[#667085]">{TITLES[page].blurb}</p>
            </div>
            {needsCohort && available.length > 1 ? (
              <div className="w-72">
                <SelectMenu
                  label="Cohort"
                  value={cohort?.id ?? ""}
                  onChange={setCohortId}
                  options={available.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.term ? `${candidate.name} — ${candidate.term}` : candidate.name,
                  }))}
                />
              </div>
            ) : null}
          </header>

          {page === "students" && !cohorts.isLoading ? <StudentRoster cohorts={available} /> : null}
          {page === "students" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "cohorts" ? <CohortList onOpen={openGroups} /> : null}
          {needsCohort && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {needsCohort && !cohorts.isLoading && !cohort ? (
            <p className="text-sm text-[#667085]">Create a cohort first, then fill its groups.</p>
          ) : null}
          {page === "groups" && cohort ? <GroupCatalogue key={cohort.id} cohort={cohort} /> : null}
        </div>
      </div>
    </div>
  );
}
