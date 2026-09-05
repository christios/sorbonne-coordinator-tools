import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PortalFilterBar } from "@/components/PortalFilterBar";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { type PortalFilter, fetchPortalFilters } from "@/services/portalLists";
import type { PortalRoster, RosterRow } from "@/services/scenRosters";

const FILTER_KEY = "scen-portal-filter:registrations";

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
  const columns: SimpleColumn<RosterRow>[] = [
    { key: "id", label: "ID", value: (row) => String(row.SPRIDEN_ID ?? ""), width: "6.5rem" },
    { key: "name", label: "Student", value: (row) => String(row.FULL_NAME ?? "") },
    { key: "year", label: "Year", value: (row) => String(row.YEARLEVEL_CODE ?? "") },
    { key: "major", label: "Major", value: (row) => String(row.MAJOR_CODE ?? "") },
    { key: "crn", label: "CRN", value: (row) => String(row.COURSE_CRN ?? "") },
    { key: "course", label: "Course", value: (row) => String(row.COURSE_CODE ?? "") },
    { key: "title", label: "Title", value: (row) => String(row.COURSE_TITLE ?? "") },
    { key: "teacher", label: "Teacher", value: (row) => String(row.TEACHER_NAME ?? "") },
  ];

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
        <SimpleTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.SPRIDEN_ID}|${row.COURSE_CRN}`}
          initialSort={{ key: "name", ascending: true }}
          searchLabel="Search this pull"
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
