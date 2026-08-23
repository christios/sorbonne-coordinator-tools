import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, Megaphone, Upload } from "lucide-react";
import { useState } from "react";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SemesterImport } from "@/components/SemesterImport";
import { SemesterList } from "@/components/SemesterList";
import { SidePane } from "@/components/SidePane";
import { fetchTimetableStatus } from "@/services/timetables";

const PAGES = [
  { id: "semesters", name: "Semesters", icon: CalendarDays },
  { id: "import", name: "Import a semester", icon: Upload },
  { id: "announcements", name: "Announcements", icon: Megaphone },
] as const;

type PageId = (typeof PAGES)[number]["id"];

const TITLES: Record<PageId, { title: string; blurb: string }> = {
  semesters: {
    title: "Semesters",
    blurb: "What the student platform holds, and whether students can see it yet.",
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
  const [page, setPage] = useState<PageId>("semesters");

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
          </header>

          {page === "semesters" ? <SemesterList /> : null}
          {page === "import" ? <SemesterImport host={status.data.host} /> : null}
          {page === "announcements" ? <AnnouncementEditor /> : null}
        </div>
      </div>
    </div>
  );
}
