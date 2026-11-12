import { AlertTriangle } from "lucide-react";

import type { FilterModel } from "@/services/tableFilter";

/** "Mathematics", "Mathematics or Physics", "Mathematics, Physics or Chemistry". */
function joined(values: string[], word: "or" | "and"): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} ${word} ${values[values.length - 1]}`;
}

/** "courses in the Mathematics program", "courses in the Mathematics or Physics programs". */
function courses(values: string[], word: "or" | "and"): string {
  return `courses in the ${joined(values, word)} program${values.length > 1 ? "s" : ""}`;
}

/** Which teachers a Program filter keeps, in the words of its operator. */
function kept(filter: FilterModel): string {
  const { operator, values } = filter;
  if (operator === "include all of") return `Only teachers who teach ${courses(values, "and")} stay.`;
  if (operator === "exclude" || operator === "exclude if any of") return `Teachers who teach ${courses(values, "or")} are left out.`;
  if (operator === "exclude if all") return `Teachers who teach ${courses(values, "and")} are left out.`;
  return `Only teachers who teach ${courses(values, "or")} stay.`;
}

/**
 * What a Program filter on Teacher hours does, said while it is on: it picks teachers by the
 * programmes of the courses they teach, and leaves their hours whole — the registrar books
 * them, and the pay sheets count them, per teacher rather than per course.
 */
export function ProgrammeFilterNote({ filter }: { filter: FilterModel }) {
  return (
    <p role="status" className="mt-2 flex items-center gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]">
      <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
      <span>
        {kept(filter)} <span className="font-semibold">Their hours are not filtered:</span> each total still counts all their
        courses.
      </span>
    </p>
  );
}
