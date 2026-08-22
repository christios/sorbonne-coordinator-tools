import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ScreenLoading } from "@/components/ScreenLoading";
import { courseFamilies } from "@/services/rosterReconcile";
import { fetchRoster, type TimetableTerm } from "@/services/timetables";

/**
 * The term's own Reference sheet: every group a coordinator can choose, and the CRN it
 * resolves to. Read-only by design — CRNs come from the registrar's export, and the only
 * thing a coordinator decides is which group a student belongs to.
 */
export function CourseReference({ term }: { term: TimetableTerm }) {
  const roster = useQuery({ queryKey: ["roster", term.id], queryFn: () => fetchRoster(term.id) });
  const families = useMemo(() => courseFamilies(roster.data?.courses ?? []), [roster.data]);

  if (roster.isLoading) return <ScreenLoading label="Loading the catalogue…" />;
  if (roster.error) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {(roster.error as Error).message}
      </p>
    );
  }

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm leading-6 text-[#667085]">
        What each group resolves to, taken from the semester's timetable export. Nothing here is
        editable: a coordinator picks a group on the Students page, and the CRN follows from it.
      </p>

      <div className="space-y-4">
        {families.map((family) => (
          <section key={family.key} className="rounded-lg border border-[#d9dee7] bg-white">
            <header className="flex flex-wrap items-baseline gap-x-3 border-b border-[#e4e8ef] px-5 py-3">
              <h3 className="text-base font-semibold text-[#171717]">{family.label}</h3>
              <p className="text-sm text-[#667085]">
                {family.title}
                {family.kind ? ` · ${family.kind}` : ""} · {family.options.length} group
                {family.options.length === 1 ? "" : "s"}
              </p>
            </header>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[#667085]">
                <tr>
                  <th scope="col" className="px-5 py-2 font-semibold">Group</th>
                  <th scope="col" className="px-5 py-2 font-semibold">CRN</th>
                  <th scope="col" className="px-5 py-2 font-semibold">Section code</th>
                  <th scope="col" className="px-5 py-2 font-semibold">Teacher</th>
                </tr>
              </thead>
              <tbody>
                {family.options.map((option) => (
                  <tr key={option.crn} className="border-t border-[#eef1f5]">
                    <td className="px-5 py-2 font-semibold text-[#171717]">{option.group}</td>
                    <td className="px-5 py-2 tabular-nums">{option.crn}</td>
                    <td className="px-5 py-2 text-[#667085]">{option.code}</td>
                    <td className="px-5 py-2 text-[#667085]">{option.staff || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {families.length === 0 ? (
          <p className="text-sm text-[#667085]">This semester has no courses yet.</p>
        ) : null}
      </div>
    </>
  );
}
