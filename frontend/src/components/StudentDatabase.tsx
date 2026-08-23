import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Layers, ListTree, Loader2, Settings, Users } from "lucide-react";
import { useState } from "react";

import { CohortList } from "@/components/CohortList";
import { GroupCatalogue } from "@/components/GroupCatalogue";
import { PortalViews } from "@/components/PortalViews";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StaffMenu } from "@/components/StaffMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { SidePane } from "@/components/SidePane";
import { SyncSettings } from "@/components/SyncSettings";
import { recordPull } from "@/services/pullHistory";
import { rememberPull, rememberSync } from "@/services/rosterStore";
import { PortalError, pullFilter, studentIdOf } from "@/services/scenRosters";
import type { Filter } from "@/services/filterSummary";
import {
  fetchCohorts,
  fetchSyncSettings,
  syncStudents,
  type Cohort,
} from "@/services/studentDatabase";

const PAGES = [
  { id: "students", name: "Students", icon: Users },
  { id: "views", name: "Portal views", icon: Eye },
  { id: "cohorts", name: "Cohorts", icon: Layers },
  { id: "groups", name: "Groups & CRNs", icon: ListTree },
] as const;

type PageId = (typeof PAGES)[number]["id"];

const TITLES: Record<PageId, { title: string; blurb: string }> = {
  students: {
    title: "Students",
    blurb: "Every student we hold. The list is built by the sync, and cohorts are assembled from it.",
  },
  views: {
    title: "Portal views",
    blurb: "Look at slices of the portal without changing anything. Views never feed the student list.",
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
export function StudentDatabase({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
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
    <div className="flex min-h-0 flex-1">
      <SidePane
        label="Student database pages"
        heading="Student database"
        items={PAGES.map(({ id, name, icon }) => ({ id, name, icon }))}
        activeId={page}
        onSelect={(id) => setPage(id as PageId)}
        // Who is signed in, and their settings, belong at the foot of whichever pane is
        // on screen — inside a tool that is this one, not the launcher's.
        footer={<StaffMenu variant="sidebar" onOpenSettings={onOpenSettings} />}
      />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[86rem] px-4 py-6 sm:px-6">
          <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
            <div>
              <h2 className="text-2xl font-semibold text-[#171717]">{TITLES[page].title}</h2>
              <p className="mt-1 text-sm text-[#667085]">{TITLES[page].blurb}</p>
            </div>

            {page === "students" ? <SyncControl /> : null}

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
          {page === "views" ? <PortalViews /> : null}
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

/**
 * The one action that changes who is a student, and the settings that define it.
 *
 * It sits in the header rather than in the table's toolbar because it is not a way of
 * looking at the table — it is what the table is made of.
 */
function SyncControl() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["sync-settings"], queryFn: fetchSyncSettings });
  const [open, setOpen] = useState(false);

  const sync = useMutation({
    mutationFn: async () => {
      const filter = (settings.data?.filter ?? {}) as Filter;
      const roster = await pullFilter(filter, {
        name: "Sync",
        expect: null,
      });
      const report = await syncStudents(roster.rows.map(studentIdOf).filter(Boolean));
      rememberPull({ ...roster, presetId: "sync" });
      rememberSync(report.syncedAt);
      // What the portal said this time, kept as a delta against last time, so the panel
      // can answer "what has changed about this student" months from now.
      recordPull(roster.rows, roster.fetchedAt);
      return report;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["students"] });
      client.invalidateQueries({ queryKey: ["cohorts"] });
    },
  });

  const report = sync.data;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={sync.isPending || settings.isLoading}
          onClick={() => sync.mutate()}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sync.isPending ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={16} aria-hidden="true" />
          )}
          {sync.isPending ? "Syncing…" : "Sync with portal"}
        </button>
        <button
          type="button"
          aria-label="Sync settings"
          title="Sync settings"
          onClick={() => setOpen(true)}
          className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]"
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </div>

      {sync.error ? (
        <p role="alert" className="max-w-sm text-right text-xs text-[#a6292f]">
          {sync.error instanceof PortalError ? sync.error.message : (sync.error as Error).message}
        </p>
      ) : report ? (
        <p className="text-xs text-[#98a2b3]">
          {report.seen} returned · {report.added} added · {report.missing} no longer in the portal
        </p>
      ) : null}

      <SyncSettings open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
