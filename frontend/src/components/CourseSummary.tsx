import { BookOpen, CalendarClock, FileSpreadsheet, Users } from "lucide-react";

import { CourseInfo } from "@/services/rosters";

type Props = {
  courseInfo: CourseInfo;
  rowCount: number;
  pageCount: number;
};

export function CourseSummary({ courseInfo, rowCount, pageCount }: Props) {
  const facts = [
    { label: "Course", value: courseInfo.course_code, icon: BookOpen },
    { label: "CRN", value: courseInfo.crn, icon: FileSpreadsheet },
    { label: "Rows", value: String(rowCount), icon: Users },
    { label: "Pages", value: String(pageCount), icon: CalendarClock },
  ];

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white">
      <div className="border-b border-[#edf0f4] px-5 py-4">
        <h2 className="text-base font-semibold text-[#171717]">Course Info</h2>
      </div>
      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="border-b border-[#edf0f4] px-5 py-4 sm:border-r lg:border-b-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-[#667085]">
              <fact.icon size={15} aria-hidden="true" />
              {fact.label}
            </div>
            <div className="truncate text-lg font-semibold text-[#171717]">{fact.value ?? "-"}</div>
          </div>
        ))}
      </div>
      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2">
        <Info label="Title" value={courseInfo.course_title} />
        <Info label="Term" value={courseInfo.term} />
        <Info label="Department" value={courseInfo.department} />
        <Info label="Teacher" value={courseInfo.teacher} />
        <Info label="Contact Hours" value={courseInfo.contact_hours} />
        <Info label="Printed On" value={courseInfo.printed_on} />
      </dl>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-normal text-[#667085]">{label}</dt>
      <dd className="mt-1 break-words text-[#24272d]">{value || "-"}</dd>
    </div>
  );
}
