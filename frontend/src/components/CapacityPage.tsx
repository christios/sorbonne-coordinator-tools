import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ListGrid, StatePill } from "@/components/ListGrid";
import { ScreenLoading } from "@/components/ScreenLoading";
import { capacityColumns, capacityRows, groupTotals, type CapacityRow } from "@/services/capacity";
import { fetchActiveCourses, fetchActiveTeachers } from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

const SHOWN = ["cohortName", "set", "group", "courseCode", "component", "crn", "teacher", "capacity", "enrolled", "free", "status"];

const idOf = (row: CapacityRow) => row.key;
const labelOf = (row: CapacityRow) => `${row.cohortName} ${row.set} ${row.group} ${row.courseCode}`;

const TONES = {
  Over: "bad",
  Full: "good",
  Room: "muted",
  Empty: "muted",
  "No capacity set": "muted",
} as const;

const renderCell = (row: CapacityRow, column: GridColumn<CapacityRow>) => {
  if (column.id === "status") return <StatePill tone={TONES[row.status]}>{row.status}</StatePill>;
  if (column.id === "free") {
    if (!row.capacity) return <span className="text-[#c8d0da]">—</span>;
    return <span className={`tabular-nums ${row.free < 0 ? "font-semibold text-[#a6292f]" : ""}`}>{row.free}</span>;
  }
  if (column.id === "capacity" && !row.capacity) return <span className="text-[#c8d0da]">not set</span>;
  if (column.id === "shared") return row.shared ? <StatePill tone="accent">Every cohort</StatePill> : <span className="text-[#98a2b3]">—</span>;
  return undefined;
};

/**
 * How full every group is — the Capacity sheet the workbooks carried, kept live.
 *
 * One row per section: its CRN, the group it belongs to, the seats that group has and
 * how many are taken. A group's enrolment belongs to the group rather than to any one
 * course, so the sections of one group all read the same count, exactly as the sheet did.
 * Retired sections are not listed, because nobody is in them.
 */
export function CapacityPage() {
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });

  const rows = useMemo(() => {
    const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
    const teacherName = (id: string) => (teachers.data ?? []).find((teacher) => teacher.id === id)?.fullName ?? "";
    return capacityRows(catalogues.data ?? [], termName, courses.data ?? [], teacherName);
  }, [catalogues.data, terms.data, courses.data, teachers.data]);

  const columns = useMemo(() => capacityColumns(), []);
  const totals = useMemo(() => groupTotals(rows), [rows]);

  if (catalogues.isLoading) return <ScreenLoading label="Counting the seats…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;

  return (
    <section>
      <ListGrid
        columns={columns}
        rows={rows}
        idOf={idOf}
        labelOf={labelOf}
        layoutKey="scen-columns:capacity:v1"
        presetKey="scen-copy-presets:capacity:v1"
        shown={SHOWN}
        initialSort={{ key: "cohortName", ascending: true }}
        searchLabel="Search groups, courses, teachers"
        noun="sections"
        renderCell={renderCell}
        empty="No sections yet. Groups & CRNs is where they are made."
      />

      <p className="mt-2 text-xs text-[#98a2b3]">
        {totals.groups} group{totals.groups === 1 ? "" : "s"} counted once, holding {totals.enrolled.toLocaleString()}{" "}
        student{totals.enrolled === 1 ? "" : "s"}.{" "}
        {totals.seated ? (
          <>
            {totals.capacity.toLocaleString()} seats across the {totals.seated} that state a capacity
            {totals.over ? (
              <span className="font-semibold text-[#a6292f]">, {totals.over} of them over</span>
            ) : (
              ", none over"
            )}
            .{" "}
          </>
        ) : null}
        {totals.withoutCapacity ? `${totals.withoutCapacity} state none. ` : ""}
        A group&apos;s enrolment is the group&apos;s, so its sections repeat the same count.
      </p>
    </section>
  );
}
