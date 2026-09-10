import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ListGrid, StatePill } from "@/components/ListGrid";
import { PortalFilterBar } from "@/components/PortalFilterBar";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { type PortalCourse, addActiveCourses, fetchActiveCourses, fetchPortalCourses } from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";

const FILTER_KEY = "scen-portal-filter:courses";

const COLUMNS: GridColumn<PortalCourse>[] = [
  { id: "crn", displayName: "CRN", type: "text", accessor: (row) => row.crn, required: true, defaultWidth: 90 },
  { id: "courseCode", displayName: "Course", type: "text", accessor: (row) => row.courseCode, required: true, defaultWidth: 130 },
  { id: "title", displayName: "Title", type: "text", accessor: (row) => row.title, defaultWidth: 260 },
  { id: "sequence", displayName: "Seq.", type: "text", accessor: (row) => row.sequence, defaultWidth: 70 },
  { id: "partOfTerm", displayName: "Part of term", type: "option", accessor: (row) => row.partOfTermDesc || row.partOfTerm, defaultWidth: 160 },
  { id: "credits", displayName: "Credits", type: "number", accessor: (row) => Number(row.credits) || 0, defaultWidth: 90 },
  { id: "department", displayName: "Dept.", type: "option", accessor: (row) => row.department, defaultWidth: 90 },
  { id: "level", displayName: "Level", type: "option", accessor: (row) => row.level, defaultWidth: 80 },
  { id: "college", displayName: "College", type: "option", accessor: (row) => row.college, defaultWidth: 90 },
  { id: "contactHours", displayName: "Contact hrs", type: "number", accessor: (row) => Number(row.contactHours) || 0, defaultWidth: 100 },
  { id: "teacherName", displayName: "Teacher", type: "option", accessor: (row) => row.teacherName, defaultWidth: 200 },
  { id: "registered", displayName: "Registered", type: "number", accessor: (row) => row.registered, defaultWidth: 100 },
  { id: "subject", displayName: "Subject", type: "option", accessor: (row) => row.subject, defaultWidth: 90 },
  { id: "begins", displayName: "Begins", type: "text", accessor: (row) => row.begins, defaultWidth: 110 },
  { id: "ends", displayName: "Ends", type: "text", accessor: (row) => row.ends, defaultWidth: 110 },
  { id: "termCode", displayName: "Term", type: "option", accessor: (row) => row.termCode, defaultWidth: 90 },
  {
    id: "status",
    displayName: "Portal",
    type: "option",
    accessor: (row) => (row.status === "in_portal" ? "In portal" : "No longer listed"),
    defaultWidth: 130,
  },
  { id: "lastSeenAt", displayName: "Last seen", type: "date", accessor: (row) => row.lastSeenAt, display: (row) => row.lastSeenAt.slice(0, 10), defaultWidth: 120 },
  // Whether the course is on the department's own list; the accessor is filled in on the page.
  { id: "active", displayName: "Active", type: "option", accessor: () => "", defaultWidth: 90 },
];
const SHOWN = ["crn", "courseCode", "title", "partOfTerm", "credits", "department", "level", "teacherName", "registered", "status", "active"];

const idOf = (row: PortalCourse) => `${row.termCode}|${row.crn}`;
const labelOf = (row: PortalCourse) => `${row.courseCode} ${row.crn}`;

/**
 * The term's CRNs as the registrar portal lists them.
 *
 * This is the reference the rest of the application checks itself against: a CRN typed
 * into a group, a CRN the Student Hub teaches, a CRN a student is registered in. It is
 * the portal's own answer, pulled by filter, and says when it was last asked.
 */
export function PortalCourses() {
  const client = useQueryClient();
  const [filterId, setFilterId] = useState(() => remembered(FILTER_KEY));
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const courses = useQuery({ queryKey: ["portal", "courses", filterId], queryFn: () => fetchPortalCourses("", filterId) });
  const active = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const activeCodes = useMemo(() => new Set((active.data ?? []).map((row) => row.courseCode.toUpperCase())), [active.data]);
  const isActive = (row: PortalCourse) => activeCodes.has(row.courseCode.toUpperCase());

  const add = useMutation({
    mutationFn: (codes: string[]) => addActiveCourses({ courseCodes: codes }),
    onSuccess: () => {
      setSelected(new Set());
      // Choosing a course takes its CRNs into the register with it, so both move.
      client.invalidateQueries({ queryKey: ["active-courses"] });
      client.invalidateQueries({ queryKey: ["active-crns"] });
      client.invalidateQueries({ queryKey: ["register-check"] });
    },
  });
  // The Active column reads the department's list, so the column model borrows it here.
  const columns = COLUMNS.map((column) => (column.id === "active" ? { ...column, accessor: (row: PortalCourse) => (isActive(row) ? "Active" : "") } : column));
  const renderCell = (row: PortalCourse, column: GridColumn<PortalCourse>) => {
    if (column.id === "status") return row.status === "in_portal" ? <StatePill tone="good">In portal</StatePill> : <StatePill tone="bad">No longer listed</StatePill>;
    if (column.id === "active") return isActive(row) ? <StatePill tone="good">Active</StatePill> : <span className="text-[#98a2b3]">—</span>;
    return undefined;
  };

  const terms = useMemo(() => courses.data?.terms ?? [], [courses.data]);
  useEffect(() => {
    if (terms.length && !terms.includes(term)) setTerm(terms[0]);
  }, [terms, term]);
  const rows = useMemo(
    () => (courses.data?.courses ?? []).filter((course) => !term || course.termCode === term),
    [courses.data, term],
  );
  // A selection is CRNs; what becomes active is the course, once however many CRNs were ticked.
  const chosen = [
    ...new Set(rows.filter((row) => selected.has(idOf(row)) && !isActive(row)).map((row) => row.courseCode.toUpperCase())),
  ];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[#667085]">
          One row per CRN, as the portal lists it. Groups &amp; CRNs and Semesters check their CRNs against this
          list, so keep the filter that covers the department synced. Select the courses the department deals with
          and add them to Active courses.
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
        <ListGrid
          columns={columns}
          rows={rows}
          idOf={idOf}
          labelOf={labelOf}
          layoutKey="scen-columns:courses:v1"
          presetKey="scen-copy-presets:courses:v1"
          shown={SHOWN}
          initialSort={{ key: "courseCode", ascending: true }}
          searchLabel="Search courses"
          noun="courses"
          selected={selected}
          onSelectedChange={setSelected}
          renderCell={renderCell}
          empty={filterId ? "Nothing pulled yet — sync the filter." : "Choose a portal filter, or make one."}
          toolbar={
            <>
              {terms.length > 1 ? (
                <div className="w-40">
                  <SelectMenu label="Term" value={term} onChange={setTerm} options={terms.map((code) => ({ value: code, label: code }))} />
                </div>
              ) : null}
              <button
                type="button"
                disabled={chosen.length === 0 || add.isPending}
                title={selected.size && !chosen.length ? "Every selected course is already active" : "Add the selected courses to Active courses"}
                onClick={() => add.mutate(chosen)}
                className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <BookPlus size={15} aria-hidden="true" />
                {chosen.length ? `Add ${chosen.length} to active courses` : "Add to active courses"}
              </button>
              {add.error ? <span role="alert" className="text-sm text-[#a6292f]">{(add.error as Error).message}</span> : null}
            </>
          }
        />
      )}
    </section>
  );
}

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
