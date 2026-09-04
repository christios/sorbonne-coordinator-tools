import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ListChecks, ListTree, Megaphone, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { CohortActions } from "@/components/CohortActions";
import { CohortsPage } from "@/components/CohortsPage";
import { LabelledPicker } from "@/components/LabelledPicker";
import { GroupCatalogue } from "@/components/GroupCatalogue";
import { PlatformNotConfigured } from "@/components/PlatformNotConfigured";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { SemesterList } from "@/components/SemesterList";
import { StaffMenu } from "@/components/StaffMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { SidePane } from "@/components/SidePane";
import { ViewBar } from "@/components/ViewBar";
import { locationFor, pageFromLocation } from "@/routes/toolRoute";
import { fetchCohorts, fetchViews } from "@/services/studentDatabase";
import { fetchTimetableStatus, fetchTimetableTerms } from "@/services/timetables";

// Two families of page in one pane: what this application knows about students, and what
// the Student Hub shows them. They belong together because they are the same job —
// the CRNs a cohort is taught in are the CRNs its timetable is built from.
const PAGES = [
  { id: "students", name: "Students", icon: Users, group: "Students" },
  // Directly under Students, as its sub-tab: the pane draws a child beneath its parent.
  { id: "cohorts", name: "Cohorts", icon: ListChecks, group: "Students", parent: "students" },
  { id: "groups", name: "Groups & CRNs", icon: ListTree, group: "Students" },
  { id: "semesters", name: "Semesters", icon: CalendarDays, group: "Timetables" },
  { id: "announcements", name: "Announcements", icon: Megaphone, group: "Timetables" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

/** The page the address names, or the one to open when it names none we know. */
function pageOf(hash: string): PageId {
  const named = pageFromLocation(hash);
  return PAGES.some((candidate) => candidate.id === named) ? (named as PageId) : "students";
}

// A blurb is optional: the Students page explains itself through the view picker.
const TITLES: Record<PageId, { title: string; blurb?: string }> = {
  students: {
    title: "Students",
  },
  groups: {
    title: "Groups & CRNs",
    blurb: "What each group stands for: one CRN per course in the block.",
  },
  cohorts: {
    title: "Cohorts",
    blurb: "Where what admissions says about a student has drifted from where the department put them.",
  },
  semesters: {
    title: "Semesters",
    blurb: "What the Student Hub holds, and whether students can see it yet.",
  },
  announcements: {
    title: "Announcements",
    blurb: "The notice strip above the students' timetable.",
  },
};

/**
 * Students and their timetables — one application, because they are one job.
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
  /*
   * The page lives in the address, not only in state.
   *
   * It was state alone, so every reload — and every press of the back button — dropped
   * the coordinator on Students however deep in the work they were, and a link to a page
   * could not be sent to anybody. The address is now the truth, and the sidebar writes to
   * it rather than to a variable.
   */
  const [page, setPage] = useState<PageId>(() => pageOf(window.location.hash));

  useEffect(() => {
    const follow = () => setPage(pageOf(window.location.hash));
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const openPage = useCallback((next: PageId) => {
    setPage(next);
    // Replace rather than push: which page you are on inside a tool is where you are, not
    // a step in a journey, and pushing would make Back walk every page you had glanced at
    // on the way. replaceState also changes the address without navigating, so nothing
    // remounts underneath the choice.
    window.history.replaceState(null, "", `#${locationFor("database", next)}`);
  }, []);
  const [termId, setTermId] = useState("");
  // Set when the Groups page sends somebody here: the Students table opens on exactly them.
  const [preselect, setPreselect] = useState<string[]>([]);
  // Set when a cohort's member count is pressed: the Students table filters to that cohort.
  const [filterCohort, setFilterCohort] = useState("");
  const onPlatform = page === "semesters" || page === "announcements";
  const status = useQuery({
    queryKey: ["timetable-status"],
    queryFn: fetchTimetableStatus,
    enabled: onPlatform || page === "groups",
  });
  const terms = useQuery({
    queryKey: ["timetable-terms"],
    queryFn: fetchTimetableTerms,
    enabled: status.data?.configured === true,
  });

  const semesters = useMemo(() => terms.data ?? [], [terms.data]);
  // Land on a semester rather than on nothing, the way the view picker does.
  useEffect(() => {
    if (semesters.length && !semesters.some((term) => term.id === termId)) setTermId(semesters[0].id);
  }, [semesters, termId]);
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

  return (
    <div className="flex min-h-0 flex-1">
      <SidePane
        label="Students and timetables pages"
        heading="Students and timetables"
        items={PAGES.map(({ id, name, icon, group, ...rest }) => ({ id, name, icon, group, ...rest }))}
        activeId={page}
        onSelect={(id) => openPage(id as PageId)}
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

            {needsCohort ? (
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                <LabelledPicker
                  label="Cohort"
                  hint={knownCohorts.length > 1 ? "" : "the only one"}
                  beside={
                    cohort ? (
                      <CohortActions
                        cohort={cohort}
                        onShowMembers={(chosen) => {
                          setFilterCohort(chosen.name);
                          setPage("students");
                        }}
                      />
                    ) : null
                  }
                >
                  <SelectMenu
                    label="Cohort"
                    value={cohort?.id ?? ""}
                    onChange={setCohortId}
                    disabled={knownCohorts.length < 2}
                    options={knownCohorts.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.term ? `${candidate.name} — ${candidate.term}` : candidate.name,
                    }))}
                  />
                </LabelledPicker>
                <LabelledPicker
                  label="Semester"
                  hint={semesters.length ? "" : "none uploaded yet"}
                >
                  <SelectMenu
                    label="Semester"
                    value={termId}
                    onChange={setTermId}
                    disabled={!semesters.length}
                    placeholder="No semester"
                    options={semesters.map((term) => ({ value: term.id, label: term.name }))}
                  />
                </LabelledPicker>
              </div>
            ) : null}
          </header>

          {/*
            * StudentRoster is deliberately not keyed on the view.
            *
            * A key there remounted the whole table whenever the view changed, throwing
            * away the column arrangement, the filters, the sort and the scroll position,
            * and putting a full-screen loader over a list React Query already had in
            * hand. It now keeps its shape and swaps its rows; the one thing that must not
            * carry across a view — the selection — is cleared inside it.
            */}
          {page === "students" && !cohorts.isLoading && !views.isLoading ? (
            available.length ? (
              <StudentRoster
                cohorts={knownCohorts}
                viewId={viewId}
                preselect={preselect}
                filterCohort={filterCohort}
              />
            ) : (
              <p className="text-sm text-[#667085]">
                No views yet. Make one to say which students the portal should be asked for.
              </p>
            )
          ) : null}
          {page === "students" && (cohorts.isLoading || views.isLoading) ? (
            <ScreenLoading label="Loading…" />
          ) : null}
          {needsCohort && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {needsCohort && !cohorts.isLoading && !cohort ? (
            <p className="text-sm text-[#667085]">Create a cohort first, then fill its groups.</p>
          ) : null}
          {page === "cohorts" && !cohorts.isLoading ? (
            <CohortsPage cohorts={knownCohorts} />
          ) : null}
          {page === "cohorts" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "groups" && cohort ? (
            <GroupCatalogue
              key={`${cohort.id}:${termId}`}
              cohort={cohort}
              termId={termId}
              onShowStudents={(ids) => {
                setPreselect(ids);
                openPage("students");
              }}
            />
          ) : null}

          {onPlatform && status.isLoading ? (
            <ScreenLoading label="Checking the Student Hub connection…" />
          ) : null}
          {onPlatform && !status.isLoading && !status.data?.configured ? <PlatformNotConfigured /> : null}
          {page === "semesters" && status.data?.configured ? <SemesterList host={status.data.host} /> : null}
          {page === "announcements" && status.data?.configured ? <AnnouncementEditor /> : null}
        </div>
      </div>
    </div>
  );
}

