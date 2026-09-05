import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";

import { ListGrid, StatePill } from "@/components/ListGrid";
import { PortalFilterBar } from "@/components/PortalFilterBar";
import { ScreenLoading } from "@/components/ScreenLoading";
import { type PortalTeacher, addActiveTeachers, fetchActiveTeachers, fetchPortalTeachers } from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";

const FILTER_KEY = "scen-portal-filter:teachers";

const TEACHER_COLUMNS: GridColumn<PortalTeacher>[] = [
  { id: "teacherId", displayName: "ID", type: "text", accessor: (row) => row.teacherId, required: true, defaultWidth: 110 },
  { id: "fullName", displayName: "Name", type: "text", accessor: (row) => row.fullName, required: true, defaultWidth: 220 },
  { id: "type", displayName: "Type", type: "option", accessor: (row) => row.type, defaultWidth: 200 },
  { id: "category", displayName: "Category", type: "option", accessor: (row) => row.category, defaultWidth: 120 },
  { id: "teacherStatus", displayName: "Status", type: "option", accessor: (row) => row.teacherStatus, defaultWidth: 90 },
  { id: "department", displayName: "Dept.", type: "option", accessor: (row) => row.department, defaultWidth: 110 },
  { id: "courses", displayName: "Courses", type: "text", accessor: (row) => row.courses, defaultWidth: 220 },
  { id: "lastTerm", displayName: "Last term", type: "option", accessor: (row) => row.lastTerm, defaultWidth: 100 },
  { id: "coursesCount", displayName: "# courses", type: "number", accessor: (row) => Number(row.coursesCount) || 0, defaultWidth: 100 },
  { id: "studentsCount", displayName: "# students", type: "number", accessor: (row) => Number(row.studentsCount) || 0, defaultWidth: 100 },
  { id: "rank", displayName: "Rank", type: "text", accessor: (row) => row.rank, defaultWidth: 180 },
  { id: "institution", displayName: "Institution", type: "text", accessor: (row) => row.institution, defaultWidth: 220 },
  { id: "psuadEmail", displayName: "E-mail", type: "text", accessor: (row) => row.psuadEmail, defaultWidth: 240 },
  {
    id: "status",
    displayName: "Portal",
    type: "option",
    accessor: (row) => (row.status === "in_portal" ? "Returned" : "No longer returned"),
    defaultWidth: 150,
  },
  { id: "active", displayName: "Active", type: "option", accessor: () => "", defaultWidth: 90 },
];
const SHOWN = ["teacherId", "fullName", "type", "department", "courses", "lastTerm", "psuadEmail", "active"];

const idOf = (row: PortalTeacher) => row.teacherId;
const labelOf = (row: PortalTeacher) => row.fullName || row.teacherId;

/**
 * Who the portal says teaches, as the department chooses its active teachers from.
 *
 * Mirrors the portal's staff list, pulled by filter. Select the teachers the department
 * deals with and add them to Active teachers, which is the department's own list.
 */
export function PortalTeachers() {
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

  const add = useMutation({
    mutationFn: (ids: string[]) => addActiveTeachers({ portalTeacherIds: ids }),
    onSuccess: () => {
      setSelected(new Set());
      client.invalidateQueries({ queryKey: ["active-teachers"] });
    },
  });

  // The Active column reads the department's list, so the column model borrows it here.
  const columns = TEACHER_COLUMNS.map((column) =>
    column.id === "active" ? { ...column, accessor: (row: PortalTeacher) => (activeIds.has(row.teacherId) ? "Active" : "") } : column,
  );
  const renderCell = (row: PortalTeacher, column: GridColumn<PortalTeacher>) => {
    if (column.id === "status") {
      return row.status === "in_portal" ? <span className="text-xs text-[#667085]">Returned</span> : <StatePill tone="bad">No longer returned</StatePill>;
    }
    if (column.id === "active") return activeIds.has(row.teacherId) ? <StatePill tone="good">Active</StatePill> : <span className="text-[#98a2b3]">—</span>;
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
