import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { ListGrid, Pills, StatePill } from "@/components/ListGrid";
import { PortalFilterBar } from "@/components/PortalFilterBar";
import type { TeacherRef } from "@/components/TeacherRecord";
import { ScreenLoading } from "@/components/ScreenLoading";
import {
  type PortalTeacher,
  addActiveTeachers,
  fetchActiveCourses,
  fetchActiveCrns,
  fetchActiveTeachers,
  fetchPortalTeachers,
  splitCodes,
} from "@/services/portalLists";
import { buildCards } from "@/services/courseCards";
import { sectionsTaughtBy } from "@/services/teacherLoad";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";
import type { GridColumn } from "@/services/studentColumns";

const FILTER_KEY = "scen-portal-filter:teachers";

const TEACHER_COLUMNS: GridColumn<PortalTeacher>[] = [
  { id: "teacherId", displayName: "ID", type: "text", accessor: (row) => row.teacherId, required: true, defaultWidth: 110, source: "portal" },
  { id: "fullName", displayName: "Name", type: "text", accessor: (row) => row.fullName, required: true, defaultWidth: 220, source: "portal" },
  { id: "type", displayName: "Type", type: "option", accessor: (row) => row.type, defaultWidth: 200, source: "portal" },
  { id: "category", displayName: "Category", type: "option", accessor: (row) => row.category, defaultWidth: 120, source: "portal" },
  { id: "teacherStatus", displayName: "Status", type: "option", accessor: (row) => row.teacherStatus, defaultWidth: 90, source: "portal" },
  { id: "department", displayName: "Dept.", type: "option", accessor: (row) => row.department, defaultWidth: 110, source: "portal" },
  /*
   * The portal gives these as one comma-separated string. Split, each code is a value the
   * table can filter by — "everyone who teaches SCEN-101" is a tick rather than a search.
   */
  {
    id: "courses",
    displayName: "Courses",
    type: "multiOption",
    accessor: (row) => splitCodes(row.courses),
    display: (row) => splitCodes(row.courses).join(", "),
    defaultWidth: 220,
    source: "portal",
  },
  /*
   * Which years they stand in front of, from our own planning rather than the portal —
   * the accessor is filled in on the page, where the planning has been read.
   */
  { id: "cohorts", displayName: "Cohorts", type: "multiOption", accessor: () => [], defaultWidth: 200, source: "planning" },
  { id: "lastTerm", displayName: "Last term", type: "option", accessor: (row) => row.lastTerm, defaultWidth: 100, source: "portal" },
  { id: "coursesCount", displayName: "# courses", type: "number", accessor: (row) => Number(row.coursesCount) || 0, defaultWidth: 100, source: "portal" },
  { id: "studentsCount", displayName: "# students", type: "number", accessor: (row) => Number(row.studentsCount) || 0, defaultWidth: 100, source: "portal" },
  { id: "rank", displayName: "Rank", type: "text", accessor: (row) => row.rank, defaultWidth: 180, source: "portal" },
  { id: "institution", displayName: "Institution", type: "text", accessor: (row) => row.institution, defaultWidth: 220, source: "portal" },
  { id: "psuadEmail", displayName: "E-mail", type: "text", accessor: (row) => row.psuadEmail, defaultWidth: 240, source: "portal" },
  {
    id: "status",
    displayName: "Portal",
    type: "option",
    accessor: (row) => (row.status === "in_portal" ? "Returned" : "No longer returned"),
    defaultWidth: 150,
  },
  { id: "active", displayName: "Active", type: "option", accessor: () => "", defaultWidth: 90, source: "planning" },
];
const SHOWN = ["teacherId", "fullName", "type", "department", "cohorts", "courses", "lastTerm", "psuadEmail", "active"];

const idOf = (row: PortalTeacher) => row.teacherId;
const labelOf = (row: PortalTeacher) => row.fullName || row.teacherId;

/**
 * Who the portal says teaches, as the department chooses its active teachers from.
 *
 * Mirrors the portal's staff list, pulled by filter. Select the teachers the department
 * deals with and add them to Active teachers, which is the department's own list.
 */
export function PortalTeachers({ onOpenTeacher }: { onOpenTeacher?: (teacher: TeacherRef) => void }) {
  const client = useQueryClient();
  const [filterId, setFilterId] = useState(() => {
    try {
      return window.localStorage.getItem(FILTER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const teachers = useQuery({ queryKey: ["portal", "teachers", filterId], queryFn: () => fetchPortalTeachers(filterId) });
  const active = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const activeIds = new Set((active.data ?? []).map((row) => row.portalTeacherId).filter(Boolean));
  // The planning, for the Cohorts column. The portal knows the courses; only we know the years.
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });

  /*
   * Which cohorts our own planning has each of these teachers standing in front of.
   *
   * A portal teacher reaches the planning two ways: through the active-teacher record
   * carrying their portal id, and by their name where no record does — the same two ways
   * every other reading of "is this section theirs" works, so this column agrees with the
   * rest of the application about whose section is whose.
   *
   * Live sections only, across every semester the planning holds.
   */
  const cohortsOf = useMemo(() => {
    const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? "";
    const parentOf = new Map((registered.data ?? []).filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn]));
    const cards = buildCards(catalogues.data ?? [], termName, courses.data ?? [], parentOf);
    const ourIdOf = new Map((active.data ?? []).filter((row) => row.portalTeacherId).map((row) => [row.portalTeacherId, row.id]));
    const held = new Map<string, string[]>();
    for (const teacher of teachers.data ?? []) {
      const names = new Set(
        sectionsTaughtBy(cards, ourIdOf.get(teacher.teacherId) ?? "", teacher.fullName)
          .filter((section) => !section.retired)
          .map((section) => section.cohortName)
          .filter(Boolean),
      );
      held.set(teacher.teacherId, [...names].sort((left, right) => left.localeCompare(right)));
    }
    return held;
  }, [catalogues.data, terms.data, courses.data, registered.data, active.data, teachers.data]);
  const cohortsFor = (row: PortalTeacher) => cohortsOf.get(row.teacherId) ?? [];

  const add = useMutation({
    mutationFn: (ids: string[]) => addActiveTeachers({ portalTeacherIds: ids }),
    onSuccess: () => {
      setSelected(new Set());
      client.invalidateQueries({ queryKey: ["active-teachers"] });
    },
  });

  // The Active column reads the department's list, so the column model borrows it here.
  const columns = TEACHER_COLUMNS.map((column) => {
    if (column.id === "active") {
      return { ...column, accessor: (row: PortalTeacher) => (activeIds.has(row.teacherId) ? "Active" : "") };
    }
    if (column.id === "cohorts") {
      return { ...column, accessor: cohortsFor, display: (row: PortalTeacher) => cohortsFor(row).join(", ") };
    }
    return column;
  });
  const renderCell = (row: PortalTeacher, column: GridColumn<PortalTeacher>) => {
    if (column.id === "status") {
      return row.status === "in_portal" ? <span className="text-xs text-[#667085]">Returned</span> : <StatePill tone="bad">No longer returned</StatePill>;
    }
    if (column.id === "active") return activeIds.has(row.teacherId) ? <StatePill tone="good">Active</StatePill> : <span className="text-[#98a2b3]">—</span>;
    // The department's own reading is drawn in the department's colour; the portal's is quiet.
    if (column.id === "cohorts") return <Pills values={cohortsFor(row)} tone="accent" />;
    if (column.id === "courses") return <Pills values={splitCodes(row.courses)} tone="muted" />;
    return undefined;
  };

  const chosen = [...selected].filter((id) => !activeIds.has(id));

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[#667085]">
          The portal&apos;s staff list, pulled by filter. Personal contact details never leave the portal.
          Select the teachers the department deals with and add them to Active teachers.
        </p>
        <PortalFilterBar
          kind="teachers"
          filterId={filterId}
          onChoose={(id) => {
            setFilterId(id);
            try {
              window.localStorage.setItem(FILTER_KEY, id);
            } catch {
              // fine
            }
          }}
        />
      </div>
      {add.error ? (
        <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {(add.error as Error).message}
        </p>
      ) : null}
      {add.data ? (
        <p className="mb-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-2.5 text-sm text-[#2f6b3d]">
          {add.data.added} added to Active teachers{add.data.linked ? `, ${add.data.linked} joined to a part-time record` : ""}
          {add.data.skipped ? `, ${add.data.skipped} already there` : ""}.
        </p>
      ) : null}

      {teachers.isLoading ? (
        <ScreenLoading label="Loading teachers…" />
      ) : teachers.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(teachers.error as Error).message}</p>
      ) : (
        <ListGrid
          columns={columns}
          rows={teachers.data ?? []}
          idOf={idOf}
          labelOf={labelOf}
          layoutKey="scen-columns:teachers:v1"
          presetKey="scen-copy-presets:teachers:v1"
          shown={SHOWN}
          initialSort={{ key: "fullName", ascending: true }}
          searchLabel="Search teachers"
          noun="teachers"
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={
            onOpenTeacher
              ? (row) =>
                  onOpenTeacher({
                    // A portal row is nobody on our list yet, so it carries no id of ours.
                    id: "",
                    fullName: row.fullName,
                    portalTeacherId: row.teacherId,
                    psuadEmail: row.psuadEmail,
                    teacherStatus: row.teacherStatus,
                    category: row.category,
                    type: row.type,
                    lastTerm: row.lastTerm,
                    department: row.department,
                    rank: row.rank,
                    courses: row.courses,
                    institution: row.institution,
                  })
              : undefined
          }
          renderCell={renderCell}
          empty={filterId ? "Nothing pulled yet — sync the filter." : "Choose a portal filter, or make one."}
          toolbar={
            <button
              type="button"
              disabled={chosen.length === 0 || add.isPending}
              title={selected.size && !chosen.length ? "Everyone selected is already active" : "Add the selected teachers to Active teachers"}
              onClick={() => add.mutate(chosen)}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <UserPlus size={15} aria-hidden="true" />
              {chosen.length ? `Add ${chosen.length} to active teachers` : "Add to active teachers"}
            </button>
          }
        />
      )}
    </section>
  );
}
