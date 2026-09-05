import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ListGrid } from "@/components/ListGrid";
import { PortalFilterBar } from "@/components/PortalFilterBar";
import { type PortalFilter, fetchPortalFilters } from "@/services/portalLists";
import type { PortalRoster, RosterRow } from "@/services/scenRosters";
import type { GridColumn } from "@/services/studentColumns";

const FILTER_KEY = "scen-portal-filter:registrations";

const field = (row: RosterRow, key: string) => String(row[key] ?? "");
const COLUMNS: GridColumn<RosterRow>[] = [
  { id: "SPRIDEN_ID", displayName: "ID", type: "text", accessor: (row) => field(row, "SPRIDEN_ID"), required: true, defaultWidth: 110 },
  { id: "FULL_NAME", displayName: "Student", type: "text", accessor: (row) => field(row, "FULL_NAME"), required: true, defaultWidth: 220 },
  { id: "YEARLEVEL_CODE", displayName: "Year", type: "option", accessor: (row) => field(row, "YEARLEVEL_CODE"), defaultWidth: 80 },
  { id: "MAJOR_CODE", displayName: "Major", type: "option", accessor: (row) => field(row, "MAJOR_CODE"), defaultWidth: 90 },
  { id: "DEPT_CODE", displayName: "Dept.", type: "option", accessor: (row) => field(row, "DEPT_CODE"), defaultWidth: 90 },
  { id: "LEVEL_CODE", displayName: "Level", type: "option", accessor: (row) => field(row, "LEVEL_CODE"), defaultWidth: 80 },
  { id: "COLLEGE_CODE", displayName: "College", type: "option", accessor: (row) => field(row, "COLLEGE_CODE"), defaultWidth: 90 },
  { id: "COURSE_CRN", displayName: "CRN", type: "text", accessor: (row) => field(row, "COURSE_CRN"), defaultWidth: 90 },
  { id: "COURSE_CODE", displayName: "Course", type: "option", accessor: (row) => field(row, "COURSE_CODE"), defaultWidth: 130 },
  { id: "COURSE_TITLE", displayName: "Title", type: "text", accessor: (row) => field(row, "COURSE_TITLE"), defaultWidth: 240 },
  { id: "TEACHER_NAME", displayName: "Teacher", type: "option", accessor: (row) => field(row, "TEACHER_NAME"), defaultWidth: 200 },
  { id: "TERM_CODE", displayName: "Term", type: "option", accessor: (row) => field(row, "TERM_CODE"), defaultWidth: 90 },
];
const SHOWN = ["SPRIDEN_ID", "FULL_NAME", "YEARLEVEL_CODE", "MAJOR_CODE", "COURSE_CRN", "COURSE_CODE", "COURSE_TITLE", "TEACHER_NAME"];

const idOf = (row: RosterRow) => `${field(row, "SPRIDEN_ID")}|${field(row, "COURSE_CRN")}`;
const labelOf = (row: RosterRow) => `${field(row, "FULL_NAME") || field(row, "SPRIDEN_ID")} in ${field(row, "COURSE_CRN")}`;

/**
 * Which courses the portal says each student is registered in.
 *
 * The pull is the portal's Student Courses list: one row per student and CRN, with the
 * student's name. The server is told only the id and the CRN — the name stays in this
 * tab, which is why the rows shown here are the last pull's and go when the page does.
 * What the server keeps is what the Cohorts page and a student's record are read from.
 */
export function PortalRegistrations() {
  const [filterId, setFilterId] = useState(() => {
    try {
      return window.localStorage.getItem(FILTER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [last, setLast] = useState<PortalRoster | null>(null);
  const filters = useQuery({ queryKey: ["portal-filters", "registrations"], queryFn: () => fetchPortalFilters("registrations") });
  const chosen: PortalFilter | null = (filters.data ?? []).find((candidate) => candidate.id === filterId) ?? null;
  const rows = last?.rows ?? [];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[#667085]">
          The portal&apos;s Student Courses list. The server keeps each student&apos;s ids and CRNs — that is
          what the Cohorts warnings and a student&apos;s record compare against — and the names in a pull
          stay in this tab.
          {chosen
            ? ` ${chosen.held} student${chosen.held === 1 ? "" : "s"} held for ${chosen.name}${chosen.lastSyncedAt ? "" : ", never synced"}.`
            : ""}
        </p>
        <PortalFilterBar
          kind="registrations"
          filterId={filterId}
          onChoose={(id) => {
            setFilterId(id);
            setLast(null);
            try {
              window.localStorage.setItem(FILTER_KEY, id);
            } catch {
              // fine
            }
          }}
          onPulled={(roster) => setLast(roster)}
        />
      </div>

      {rows.length ? (
        <ListGrid
          columns={COLUMNS}
          rows={rows}
          idOf={idOf}
          labelOf={labelOf}
          layoutKey="scen-columns:registrations:v1"
          presetKey="scen-copy-presets:registrations:v1"
          shown={SHOWN}
          initialSort={{ key: "FULL_NAME", ascending: true }}
          searchLabel="Search this pull"
          noun="registrations"
          empty="Nothing in this pull."
        />
      ) : (
        <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-6 text-sm text-[#667085]">
          {chosen
            ? "Sync the filter to see the rows it returns here. They are shown from the pull itself and are not kept anywhere."
            : "Choose a portal filter, or make one — a department is a good question to ask."}
        </p>
      )}
    </section>
  );
}
