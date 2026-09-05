import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, BookOpen, CalendarDays, ClipboardList, GaugeCircle, GraduationCap, ListChecks, ListTree, Megaphone, UserCheck, Users } from "lucide-react";
import { Globe } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ActiveCourses } from "@/components/ActiveCourses";
import { ActiveTeachers } from "@/components/ActiveTeachers";
import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { CohortsPage } from "@/components/CohortsPage";
import { CapacityPage } from "@/components/CapacityPage";
import { CourseCards } from "@/components/CourseCards";
import { DiscrepancyRulesEditor } from "@/components/DiscrepancyRulesEditor";
import { PlatformNotConfigured } from "@/components/PlatformNotConfigured";
import { PortalCourses } from "@/components/PortalCourses";
import { PortalRegistrations } from "@/components/PortalRegistrations";
import { PortalTeachers } from "@/components/PortalTeachers";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SemesterList } from "@/components/SemesterList";
import { StaffMenu } from "@/components/StaffMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { SidePane } from "@/components/SidePane";
import { ViewBar } from "@/components/ViewBar";
import { locationFor, pageFromLocation } from "@/routes/toolRoute";
import { fetchCohorts, fetchDiscrepancyRules, fetchStudents, fetchViews } from "@/services/studentDatabase";
import { fetchTimetableStatus } from "@/services/timetables";

// Two families of page in one pane: what this application knows about students, and what
// the Student Hub shows them. They belong together because they are the same job —
// the CRNs a cohort is taught in are the CRNs its timetable is built from.
const PAGES = [
  { id: "students", name: "Students", icon: Users, group: "Students" },
  // Directly under Students, as its sub-tab: the pane draws a child beneath its parent.
  { id: "cohorts", name: "Cohorts", icon: ListChecks, group: "Students", parent: "students" },
  // What the portal says each student is registered in — the pull the Cohorts warnings read.
  { id: "registrations", name: "Registrations", icon: ClipboardList, group: "Students", parent: "students" },
  { id: "groups", name: "Groups & CRNs", icon: ListTree, group: "Students" },
  // How full every group is: the Capacity sheet the workbooks carried, kept live.
  { id: "capacity", name: "Capacity", icon: GaugeCircle, group: "Students", parent: "groups" },
  { id: "courses", name: "Courses", icon: BookOpen, group: "Students" },
  // The department's own list, chosen from the portal's, where a course gets its UE and parent CRN.
  { id: "active-courses", name: "Active courses", icon: BookMarked, group: "Students", parent: "courses" },
  { id: "teachers", name: "Teachers", icon: GraduationCap, group: "Students" },
  // The department's own list, chosen from the portal's or brought from the part-time database.
  { id: "active-teachers", name: "Active teachers", icon: UserCheck, group: "Students", parent: "teachers" },
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
    blurb: "The timetable request: every course, its sections, who teaches them and what the timetable is asked for.",
  },
  cohorts: {
    title: "Cohorts",
    blurb: "Where what admissions says about a student has drifted from where the department put them.",
  },
  registrations: {
    title: "Registrations",
    blurb: "Which CRNs the portal says each student is registered in.",
  },
  capacity: {
    title: "Capacity",
    blurb: "How full every group is: its seats, who is in it, and where there is room.",
  },
  courses: {
    title: "Courses",
    blurb: "The term's CRNs as the registrar portal lists them — what everything else checks against.",
  },
  "active-courses": {
    title: "Active courses",
    blurb: "The department's own list: chosen from the portal's courses, each with its UE and the parent CRN its sections hang from.",
  },
  teachers: {
    title: "Teachers",
    blurb: "The portal's staff list — choose the teachers the department deals with from it.",
  },
  "active-teachers": {
    title: "Active teachers",
    blurb: "The department's own list: chosen from the portal, or brought from the Part-time Teacher Database.",
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
  const client = useQueryClient();
  // Set when the Groups page sends somebody here: the Students table opens on exactly them.
  const [preselect, setPreselect] = useState<string[]>([]);
  // Set when a cohort's member count is pressed: the Students table filters to that cohort.
  const [filterCohort] = useState("");
  const onPlatform = page === "semesters" || page === "announcements";
  const status = useQuery({
    queryKey: ["timetable-status"],
    queryFn: fetchTimetableStatus,
    enabled: onPlatform || page === "groups",
  });

  const [viewId, setViewId] = useState("");
  // The shared rules sit at the page's title, apart from any one cohort's.
  const [sharedRulesOpen, setSharedRulesOpen] = useState(false);
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules, enabled: page === "cohorts" });
  const sharedCount = (rules.data ?? []).filter((rule) => !rule.cohortId).length;

  const available = views.data ?? [];
  // Land on a view rather than on nothing, and recover if the chosen one is deleted.
  useEffect(() => {
    if (!available.length) return;
    if (!available.some((candidate) => candidate.id === viewId)) setViewId(available[0].id);
  }, [available, viewId]);

  /*
   * The two student lists the pages need, fetched before either page asks. The Students
   * page wants the chosen portal filter's students and the Cohorts page wants everyone;
   * each fetched only when its page opened, so the first switch between them paid for a
   * list of three thousand rows over the network — the pause a coordinator saw as the
   * page taking a second to appear. Same keys and staleness as the pages' own queries,
   * so this is the same fetch, made earlier.
   */
  useEffect(() => {
    void client.prefetchQuery({ queryKey: ["students", ""], queryFn: () => fetchStudents(""), staleTime: 5 * 60_000 });
    if (viewId) {
      void client.prefetchQuery({
        queryKey: ["students", viewId],
        queryFn: () => fetchStudents(viewId),
        staleTime: 5 * 60_000,
      });
    }
  }, [client, viewId]);

  const knownCohorts = cohorts.data ?? [];

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
            {page === "cohorts" ? (
              <button
                type="button"
                onClick={() => setSharedRulesOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
              >
                <Globe size={15} aria-hidden="true" />
                Rules for every cohort
                <span className="tabular-nums text-xs font-normal text-[#98a2b3]">{sharedCount}</span>
              </button>
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
          {page === "capacity" ? <CapacityPage /> : null}
          {page === "courses" ? <PortalCourses /> : null}
          {page === "active-courses" ? <ActiveCourses /> : null}
          {page === "teachers" ? <PortalTeachers /> : null}
          {page === "active-teachers" ? <ActiveTeachers /> : null}
          {page === "registrations" ? <PortalRegistrations /> : null}
          {page === "groups" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "cohorts" && !cohorts.isLoading ? (
            <CohortsPage cohorts={knownCohorts} />
          ) : null}
          {page === "cohorts" ? (
            <DiscrepancyRulesEditor open={sharedRulesOpen} scope={{ kind: "shared" }} onClose={() => setSharedRulesOpen(false)} />
          ) : null}
          {page === "cohorts" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "groups" && !cohorts.isLoading ? (
            <CourseCards
              cohorts={knownCohorts}
              onShowStudents={(ids: string[]) => {
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

