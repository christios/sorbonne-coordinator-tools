import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, ListTree, Megaphone, Upload, Users } from "lucide-react";
import { useState } from "react";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { CourseReference } from "@/components/CourseReference";
import { RosterConsole } from "@/components/RosterConsole";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SemesterImport } from "@/components/SemesterImport";
import { SemesterList } from "@/components/SemesterList";
import { SidePane } from "@/components/SidePane";
import { fetchTimetableStatus, fetchTimetableTerms, type TimetableTerm } from "@/services/timetables";

const PAGES = [
  { id: "semesters", name: "Semesters", icon: CalendarDays },
  { id: "students", name: "Students", icon: Users },
  { id: "reference", name: "Groups & CRNs", icon: ListTree },
  { id: "import", name: "Import a semester", icon: Upload },
  { id: "announcements", name: "Announcements", icon: Megaphone },
] as const;

type PageId = (typeof PAGES)[number]["id"];

const TITLES: Record<PageId, { title: string; blurb: string }> = {
  semesters: {
    title: "Semesters",
    blurb: "What the student platform holds, and whether students can see it yet.",
  },
  students: {
    title: "Students",
    blurb: "Reconcile against the registrar portal, and set each student's groups.",
  },
  reference: {
    title: "Groups & CRNs",
    blurb: "The semester's own reference: which group is which CRN.",
  },
  import: {
    title: "Import a semester",
    blurb: "The term-start load: the registrar export plus the filled group templates.",
  },
  announcements: {
    title: "Announcements",
    blurb: "The notice strip above the students' timetable.",
  },
};

/**
 * Timetables are stored by the SCEN Student Platform, not by this application. This tool
 * uploads a semester to it, keeps its student groups in step with the registrar portal,
 * and controls what students see — one page each, behind the same side pane as the app
 * picker.
 */
export function TimetableUploader() {
  const status = useQuery({ queryKey: ["timetable-status"], queryFn: fetchTimetableStatus });
  const terms = useQuery({
    queryKey: ["timetable-terms"],
    queryFn: fetchTimetableTerms,
    enabled: status.data?.configured === true,
  });

  const [page, setPage] = useState<PageId>("semesters");
  const [termId, setTermId] = useState("");

  if (status.isLoading) {
    return <ScreenLoading label="Checking the student platform connection…" />;
  }

  if (!status.data?.configured) {
    return (
      <div className="mx-auto max-w-[70rem] px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-[#d9dee7] bg-white p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#171717]">
            <AlertCircle size={20} className="text-[#a6292f]" aria-hidden="true" />
            Timetable uploads are not configured
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667085]">
            This deployment has no connection to the SCEN Student Platform. Set{" "}
            <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SCEN_STUDENT_PLATFORM_URL</code> and{" "}
            <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SCEN_STUDENT_PLATFORM_TOKEN</code> in the
            application settings, then redeploy.
          </p>
        </section>
      </div>
    );
  }

  const available = terms.data ?? [];
  // Default to what students are actually looking at, then to the most recent import.
  const term =
    available.find((candidate) => candidate.id === termId) ??
    available.find((candidate) => candidate.isPublished) ??
    available[0] ??
    null;

  const openStudents = (chosen: TimetableTerm) => {
    setTermId(chosen.id);
    setPage("students");
  };

  const needsTerm = page === "students" || page === "reference";

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)]">
      <SidePane
        label="Timetable pages"
        heading="Student timetables"
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
            {needsTerm && available.length > 1 ? (
              <label className="text-sm font-semibold text-[#344054]">
                Semester
                <select
                  value={term?.id ?? ""}
                  onChange={(event) => setTermId(event.target.value)}
                  className="ml-2 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
                >
                  {available.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </header>

          {page === "semesters" ? <SemesterList onOpenStudents={openStudents} /> : null}
          {page === "import" ? <SemesterImport host={status.data.host} /> : null}
          {page === "announcements" ? <AnnouncementEditor /> : null}
          {needsTerm && terms.isLoading ? <ScreenLoading label="Loading semesters…" /> : null}
          {needsTerm && !terms.isLoading && !term ? (
            <p className="text-sm text-[#667085]">
              Nothing has been uploaded yet. Import a semester first.
            </p>
          ) : null}
          {page === "students" && term ? <RosterConsole key={term.id} term={term} /> : null}
          {page === "reference" && term ? <CourseReference key={term.id} term={term} /> : null}
        </div>
      </div>
    </div>
  );
}
