import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, BookMarked, BookOpen, CalendarDays, Clock3, GaugeCircle, GraduationCap, ListChecks, ListTree, Megaphone, UserCheck, Users } from "lucide-react";
import { Globe } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ActiveCourses } from "@/components/ActiveCourses";
import { ActiveTeachers } from "@/components/ActiveTeachers";
import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { CohortsPage } from "@/components/CohortsPage";
import { GroupSchema } from "@/components/GroupSchema";
import { CapacityPage } from "@/components/CapacityPage";
import { TeacherHours } from "@/components/TeacherHours";
import { TeacherRecord, type TeacherRef } from "@/components/TeacherRecord";
import { CourseCards } from "@/components/CourseCards";
import { DiscrepancyRulesEditor } from "@/components/DiscrepancyRulesEditor";
import { PlatformNotConfigured } from "@/components/PlatformNotConfigured";
import { PortalCourses } from "@/components/PortalCourses";
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
  /*
   * Registrar validation: every page here holds what the department believes against what
   * the registrar's portal says — the students, the cohorts they were put in, the courses
   * they are registered in, and the staff teaching them.
   */
  { id: "students", name: "Students", icon: Users, group: "Registrar validation" },
  // Directly under Students, as its sub-tab: the pane draws a child beneath its parent.
  // Both halves of the registrar check: whether admissions still agrees with us about who
  // a student is, and whether the registrar registered them in the sections we placed them
  // in. Course Registration was a page of its own; it was the same table over the same
  // students, so it is a filter on this one now.
  { id: "cohorts", name: "Cohorts", icon: ListChecks, group: "Registrar validation", parent: "students" },
  { id: "courses", name: "Courses", icon: BookOpen, group: "Registrar validation" },
  // The department's own list, chosen from the portal's, where a course gets its UE and parent CRN.
  { id: "active-courses", name: "Active courses", icon: BookMarked, group: "Registrar validation", parent: "courses" },
  { id: "teachers", name: "Teachers", icon: GraduationCap, group: "Registrar validation" },
  // The department's own list, chosen from the portal's or brought from the part-time database.
  { id: "active-teachers", name: "Active teachers", icon: UserCheck, group: "Registrar validation", parent: "teachers" },
  { id: "semesters", name: "Semesters", icon: CalendarDays, group: "Timetables" },
  // The timetable request itself: the sections a semester is taught in, and how full they
  // are. It is what the semester above it publishes, not a check against the registrar.
  { id: "groups", name: "Groups & CRNs", icon: ListTree, group: "Timetables" },
  // The shape those CRNs are hung on: the sets a cohort is split into and the groups
  // inside them. It was a dialog; it is the most consequential thing here, so it is a page.
  { id: "group-schema", name: "Group schema", icon: Blocks, group: "Timetables", parent: "groups" },
  // How full every group is: the Capacity sheet the workbooks carried, kept live.
  { id: "capacity", name: "Capacity", icon: GaugeCircle, group: "Timetables", parent: "groups" },
  // What every teacher is carrying: the workbook's Teacher Hours sheet, on a page. It
  // belongs to the request rather than to the teacher list, which is why it sits here.
  { id: "teacher-hours", name: "Teacher hours", icon: Clock3, group: "Timetables", parent: "groups" },
  { id: "announcements", name: "Announcements", icon: Megaphone, group: "Timetables" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

/**
 * Pages that were folded into another one, and the address that still points at them.
 *
 * A link somebody sent, or a tab left open, must not land on Students as though it had
 * asked for nothing. Course Registration is now the register half of Cohorts, so that is
 * where its address goes.
 */
const MOVED: Record<string, PageId> = { registrations: "cohorts" };

/** The page the address names, or the one to open when it names none we know. */
function pageOf(hash: string): PageId {
  const named = pageFromLocation(hash);
  if (PAGES.some((candidate) => candidate.id === named)) return named as PageId;
  return MOVED[named] ?? "students";
}

// A blurb is optional: the Students page explains itself through the view picker.

/** The pages whose panes fill the screen rather than letting the page scroll. */
const FILLS = new Set<PageId>(["groups", "group-schema"]);

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
    blurb: "Where admissions has drifted from where the department put a student, and where the registrar has them in other sections than we did.",
  },
  "group-schema": {
    title: "Group schema",
    blurb: "The shape of a semester before the CRNs: which sets a cohort is split into, which courses each set carries, and the groups inside them.",
  },
  "teacher-hours": {
    title: "Teacher hours",
    blurb: "What every teacher is carrying this semester — the count the timetable workbook has always shown, and the hours nobody is teaching yet.",
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
  /*
   * Set when the Groups page sends somebody here: the Students table opens on exactly them.
   *
   * Cleared again the moment the table has them, because it is a handover and not a
   * setting — see StudentRoster's `onPreselectTaken`.
   */
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
  // The slot beside the page's title, for a page with controls of its own to put there.
  const [pageHeader, setPageHeader] = useState<HTMLDivElement | null>(null);
  // The teacher whose record is open, whichever list or page asked for it.
  const [teacherRecord, setTeacherRecord] = useState<TeacherRef | null>(null);
  // A cohort and some of its students, when Groups & CRNs sends them to be placed. Held
  // only until the cohort's table has them; kept longer, it narrowed that cohort again
  // every time the coordinator came back round to it.
  const [cohortFocus, setCohortFocus] = useState<{ cohortId: string; studentIds: string[] } | null>(null);
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
        {/*
          * A column as tall as the screen, for the two pages that fill it.
          *
          * Groups & CRNs and Group schema put their panes at the foot of this column and
          * let them take whatever is left, so the cohort, the warnings, the filter and the
          * search stay where they are while each pane scrolls inside itself. That needs a
          * definite height to divide up — `min-h-full` would let the column grow to its
          * content and leave the panes nothing to fill — so only those two get it, and
          * only from `lg`, where the panes are side by side. Narrower than that they are
          * stacked, and two stacked panes sharing one screen's height is two slivers; the
          * page scrolls instead, as every other page here does at every width.
          */}
        <div className={`mx-auto flex max-w-[86rem] flex-col px-4 py-6 sm:px-6 ${FILLS.has(page) ? "min-h-full lg:h-full" : "min-h-full"}`}>
          <header className={`flex flex-wrap items-end justify-between gap-4 ${FILLS.has(page) ? "pb-3" : "pb-5"}`}>
            <div>
              <h2 title={TITLES[page].blurb} className="text-2xl font-semibold text-[#171717]">{TITLES[page].title}</h2>
              {/*
                * A page whose panes fill the screen keeps its blurb to a tooltip.
                *
                * Every line above the panes is a line they do not get, and this one is a
                * sentence you read once. The title carries it for anyone who wants it.
                */}
              {TITLES[page].blurb && !FILLS.has(page) ? (
                <p className="mt-1 text-sm text-[#667085]">{TITLES[page].blurb}</p>
              ) : null}
            </div>

            {page === "students" ? (
              <ViewBar views={available} viewId={viewId} onChoose={setViewId} />
            ) : null}
            {/* Filled by Groups & CRNs, which puts its cohort and its files here. */}
            <div ref={setPageHeader} className="empty:hidden" />
            {page === "cohorts" ? (
              <button
                type="button"
                onClick={() => setSharedRulesOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
              >
                <Globe size={15} aria-hidden="true" />
                Global rules
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
                onPreselectTaken={() => setPreselect([])}
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
          {page === "teacher-hours" ? (
            <TeacherHours onOpenTeacher={setTeacherRecord} />
          ) : null}
          {page === "courses" ? <PortalCourses /> : null}
          {page === "active-courses" ? <ActiveCourses /> : null}
          {page === "teachers" ? <PortalTeachers onOpenTeacher={setTeacherRecord} /> : null}
          {page === "active-teachers" ? <ActiveTeachers onOpenTeacher={setTeacherRecord} /> : null}
          {page === "group-schema" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "group-schema" && !cohorts.isLoading ? (
            <GroupSchema cohorts={knownCohorts} onOpenGroups={() => openPage("groups")} />
          ) : null}
          {page === "groups" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "cohorts" && !cohorts.isLoading ? (
            <CohortsPage cohorts={knownCohorts} focus={cohortFocus} onFocusTaken={() => setCohortFocus(null)} />
          ) : null}
          {page === "cohorts" ? (
            <DiscrepancyRulesEditor open={sharedRulesOpen} scope={{ kind: "shared" }} onClose={() => setSharedRulesOpen(false)} />
          ) : null}
          {page === "cohorts" && cohorts.isLoading ? <ScreenLoading label="Loading cohorts…" /> : null}
          {page === "groups" && !cohorts.isLoading ? (
            <CourseCards
              cohorts={knownCohorts}
              header={pageHeader}
              onShowStudents={(ids: string[]) => {
                setPreselect(ids);
                openPage("students");
              }}
              onPlaceStudents={(cohortId: string, ids: string[]) => {
                setCohortFocus({ cohortId, studentIds: ids });
                openPage("cohorts");
              }}
            />
          ) : null}

          {teacherRecord ? (
            <TeacherRecord open teacher={teacherRecord} onClose={() => setTeacherRecord(null)} />
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

