import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { PortalFilterBar } from "@/components/PortalFilterBar";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { type PortalCourse, fetchPortalCourses } from "@/services/portalLists";

const FILTER_KEY = "scen-portal-filter:courses";

function remembered(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // a preference that cannot be kept must not break the page
  }
}

/**
 * The term's CRNs as the registrar portal lists them.
 *
 * This is the reference the rest of the application checks itself against: a CRN typed
 * into a group, a CRN the Student Hub teaches, a CRN a student is registered in. It is
 * the portal's own answer, pulled by filter, and says when it was last asked.
 */
export function PortalCourses() {
  const [filterId, setFilterId] = useState(() => remembered(FILTER_KEY));
  const [term, setTerm] = useState("");
  const [withGone, setWithGone] = useState(false);
  const courses = useQuery({
    queryKey: ["portal", "courses", filterId],
    queryFn: () => fetchPortalCourses("", filterId),
  });

  const terms = useMemo(() => courses.data?.terms ?? [], [courses.data]);
  useEffect(() => {
    if (terms.length && !terms.includes(term)) setTerm(terms[0]);
  }, [terms, term]);

  const rows = (courses.data?.courses ?? []).filter(
    (course) => (!term || course.termCode === term) && (withGone || course.status === "in_portal"),
  );

  const columns: SimpleColumn<PortalCourse>[] = [
    { key: "crn", label: "CRN", value: (row) => row.crn, width: "5rem" },
    { key: "courseCode", label: "Course", value: (row) => row.courseCode },
    { key: "title", label: "Title", value: (row) => row.title },
    { key: "sequence", label: "Seq.", value: (row) => row.sequence, width: "4rem" },
    { key: "partOfTerm", label: "Part of term", value: (row) => row.partOfTermDesc || row.partOfTerm },
    { key: "credits", label: "Credits", value: (row) => Number(row.credits) || 0, align: "right" },
    { key: "department", label: "Dept.", value: (row) => row.department },
    { key: "level", label: "Level", value: (row) => row.level },
    { key: "teacherName", label: "Teacher", value: (row) => row.teacherName },
    { key: "registered", label: "Registered", value: (row) => row.registered, align: "right" },
    {
      key: "status",
      label: "Portal",
      value: (row) => (row.status === "in_portal" ? "In portal" : "No longer listed"),
      render: (row) =>
        row.status === "in_portal" ? (
          <span className="rounded-full bg-[#eaf4ec] px-2 py-0.5 text-xs font-semibold text-[#2f6b3d]">In portal</span>
        ) : (
          <span className="rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">No longer listed</span>
        ),
    },
  ];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[#667085]">
          One row per CRN, as the portal lists it. Groups &amp; CRNs and Semesters check their CRNs against
          this list, so keep the filter that covers the department synced.
        </p>
        <PortalFilterBar
          kind="courses"
          filterId={filterId}
          onChoose={(id) => {
            setFilterId(id);
            remember(FILTER_KEY, id);
          }}
        />
      </div>

      {courses.isLoading ? (
        <ScreenLoading label="Loading courses…" />
      ) : courses.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(courses.error as Error).message}</p>
      ) : (
        <SimpleTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.termCode}|${row.crn}`}
          initialSort={{ key: "courseCode", ascending: true }}
          searchLabel="Search courses"
          empty={filterId ? "Nothing pulled yet — sync the filter." : "Choose a portal filter, or make one."}
          toolbar={
            <>
              {terms.length > 1 ? (
                <div className="w-44">
                  <SelectMenu
                    label="Term"
                    value={term}
                    onChange={setTerm}
                    options={terms.map((code) => ({ value: code, label: code }))}
                  />
                </div>
              ) : null}
              <label className="inline-flex items-center gap-2 text-sm text-[#344054]">
                <input type="checkbox" checked={withGone} onChange={(event) => setWithGone(event.target.checked)} />
                Show CRNs no longer listed
              </label>
            </>
          }
        />
      )}
    </section>
  );
}
