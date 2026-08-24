import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Layers, ListTree, Megaphone, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { CohortList } from "@/components/CohortList";
import { GroupCatalogue } from "@/components/GroupCatalogue";
import { PlatformNotConfigured } from "@/components/PlatformNotConfigured";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { SemesterList } from "@/components/SemesterList";
import { StaffMenu } from "@/components/StaffMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { SidePane } from "@/components/SidePane";
import { ViewBar } from "@/components/ViewBar";
import { fetchCohorts, fetchViews, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableStatus } from "@/services/timetables";

// Two families of page in one pane: what this application knows about students, and what
// the student platform shows them. They belong together because they are the same job —
// the CRNs a cohort is taught in are the CRNs its timetable is built from.
const PAGES = [
  { id: "students", name: "Students", icon: Users, group: "Students" },
  { id: "cohorts", name: "Cohorts", icon: Layers, group: "Students" },
  { id: "groups", name: "Groups & CRNs", icon: ListTree, group: "Students" },
  { id: "semesters", name: "Semesters", icon: CalendarDays, group: "Time-tables" },
  { id: "announcements", name: "Announcements", icon: Megaphone, group: "Time-tables" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

// A blurb is optional: the Students page explains itself through the view picker.
const TITLES: Record<PageId, { title: string; blurb?: string }> = {
  students: {
    title: "Students",
  },
  cohorts: {
    title: "Cohorts",
    blurb: "Assemble students into the groups they will be taught in.",
  },
  groups: {
    title: "Groups & CRNs",
    blurb: "What each group stands for: one CRN per course in the block.",
  },
  semesters: {
    title: "Semesters",
    blurb: "What the student platform holds, and whether students can see it yet.",
  },
  announcements: {
    title: "Announcements",
    blurb: "The notice strip above the students' timetable.",
  },
};

/**
 * Students and their time-tables — one application, because they are one job.
 *
 * It keeps student ids, the cohorts they belong to, and the groups those cohorts assign
 * them into; and it uploads and publishes the semester timetables students look up. It
 * holds no names: those arrive from the registrar extension and stay in the browser.
 *
 * The timetables themselves are not stored here either. They live in the SCEN Student
 * Platform, so the semester pages need that connection configured and say so when it is
 * missing — while the roster pages, which are this application's own, carry on regardless.
 */
export function StudentDatabase({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts });
  const views = useQuery({ queryKey: ["views"], queryFn: fetchViews });
  const [page, setPage] = useState<PageId>("students");
  const onPlatform = page === "semesters" || page === "announcements";
  const status = useQuery({
    queryKey: ["timetable-status"],
    queryFn: fetchTimetableStatus,
    enabled: onPlatform,
  });
  const [cohortId, setCohortId] = useState("");
  const [viewId, setViewId] = useState("");

  const available = views.data ?? [];
  // Land on a view rather than on nothing, and recover if the chosen one is deleted.
  useEffect(() => {
    if (!available.length) return;
    if (!available.some((candidate) => candidate.id === viewId)) setViewId(available[0].id);
  }, [available, viewId]);

  const knownCohorts = cohorts.data ?? [];
  const cohort = knownCohorts.find((candidate) => candidate.id === cohortId) ?? knownCohorts[0] ?? null;
  const needsCohort = page === "groups";

  const openGroups = (chosen: Cohort) => {
    setCohortId(chosen.id);
    setPage("groups");
  };

  return (
    <div className="flex min-h-0 flex-1">
      <SidePane
        label="Students and time-tables pages"
        heading="Students and time-tables"
        items={PAGES.map(({ id, name, icon, group }) => ({ id, name, icon, group }))}
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
              {TITLES[page].blurb ? (
                <p className="mt-1 text-sm text-[#667085]">{TITLES[page].blurb}</p>
              ) : null}
            </div>

            {page === "students" ? (
              <ViewBar views={available} viewId={viewId} onChoose={setViewId} />
            ) : null}

            {needsCohort && knownCohorts.length > 1 ? (
              <div className="w-72">
                <SelectMenu
                  label="Cohort"
                  value={cohort?.id ?? ""}
                  onChange={setCohortId}
                  options={knownCohorts.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.term ? `${candidate.name} — ${candidate.term}` : candidate.name,
                  }))}
                />
              </div>
            ) : null}
          </header>

          {page === "students" && !cohorts.isLoading && !views.isLoading ? (
            available.length ? (
              <StudentRoster key={viewId} cohorts={knownCohorts} viewId={viewId} />
            ) : (
              <p className="text-sm text-[#667085]">
                No views yet. Make one to say which students the portal should be asked for.
              </p>
            )
          ) : null}
          {page === "students" && (cohorts.isLoading || views.isLoading) ? (
            <ScreenLoading label="Loading…" />
          ) : null}
          {page === "cohorts" ? <CohortList onOpen={openGroups} /> : null}
          {needsCohort && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {needsCohort && !cohorts.isLoading && !cohort ? (
            <p className="text-sm text-[#667085]">Create a cohort first, then fill its groups.</p>
          ) : null}
          {page === "groups" && cohort ? <GroupCatalogue key={cohort.id} cohort={cohort} /> : null}

          {onPlatform && status.isLoading ? (
            <ScreenLoading label="Checking the student platform connection…" />
          ) : null}
          {onPlatform && !status.isLoading && !status.data?.configured ? <PlatformNotConfigured /> : null}
          {page === "semesters" && status.data?.configured ? <SemesterList host={status.data.host} /> : null}
          {page === "announcements" && status.data?.configured ? <AnnouncementEditor /> : null}
        </div>
      </div>
    </div>
  );
}
