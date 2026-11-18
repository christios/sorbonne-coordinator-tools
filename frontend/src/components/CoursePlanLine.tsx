import { AlertTriangle } from "lucide-react";

import { InfoTip, TipDo, TipPage, TipPoint } from "@/components/InfoTip";
import {
  componentOf,
  figure,
  hoursWords,
  layoutWords,
  lengthWords,
  rowDrift,
  sessionsOf,
  type CoursePlan,
} from "@/services/coursePlans";
import type { Request } from "@/services/studentDatabase";

/**
 * A set's course row beside the course plan: the hours coordinators set for the course's
 * component this semester, and — in amber — where the row, or a section's own answer, says
 * something else.
 *
 * Shown, never copied: the rows keep their own hours, which Teaching loads and requisitions
 * go on reading (user, 18 Nov 2026).
 */
export function CoursePlanLine({
  plan,
  component: said,
  request,
  sections,
}: {
  plan: CoursePlan | null | undefined;
  /** The set's component, CM, TD or TP. */
  component: string;
  request: Pick<Request, "hours" | "duration">;
  /** Each live section's own hours and session length, by its label: "TD 3". */
  sections: { label: string; hours: string; duration: string }[];
}) {
  const component = componentOf({ component: said });
  if (!plan || !component) return null;
  const held = plan.components[component];
  if (!held.hours) {
    return (
      <p className="mb-2.5 text-xs text-[#98a2b3]">
        Course plan: no {component} hours set for this semester yet, on Active courses.
      </p>
    );
  }
  const row = rowDrift(request, held);
  const differences: string[] = [];
  if (row.hours === "differs") differences.push(`the course asks ${request.hours} h, not ${figure(held.hours)}`);
  if (row.length === "differs") differences.push(`sessions of ${request.duration} h here, ${figure(held.length ?? 0)} h in the plan`);
  const ownHours = sections.filter((section) => rowDrift(section, held).hours === "differs");
  const ownLength = sections.filter((section) => rowDrift(section, held).length === "differs");
  if (ownHours.length) differences.push(`${ownHours.map((section) => `${section.label} says ${section.hours} h`).join(", ")}`);
  if (ownLength.length) differences.push(`${ownLength.map((section) => `${section.label} has ${section.duration} h sessions`).join(", ")}`);
  const weeks = plan.weeks[component];

  return (
    <div data-course-plan={component} className="-mt-1 mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-xs">
      <span className="inline-flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a94a4]">Course plan</span>
        <InfoTip label="What the course plan is" title="Course plan">
          <TipDo>The hours set for the course this semester on <TipPage name="Active courses" />, shared by every cohort.</TipDo>
          <TipPoint>The course&rsquo;s lead lays them out week by week; the Semester plan proposes those weeks.</TipPoint>
          <TipPoint>This row keeps its own hours: amber says where it differs. Teaching loads read the row.</TipPoint>
        </InfoTip>
      </span>
      <span className="font-semibold tabular-nums text-[#1f4e79]">
        {component} {hoursWords(component, held)} · {figure(held.length ?? 0)} h sessions
      </span>
      {sessionsOf(weeks) ? <span className="text-[#667085]">{layoutWords(weeks)}</span> : null}
      {Object.keys(plan.lengths?.[component] ?? {}).length ? (
        <span className="font-semibold text-[#8a6116]">{lengthWords(plan.lengths?.[component])}</span>
      ) : null}
      {differences.length ? (
        <span className="inline-flex items-center gap-1 font-semibold text-[#8a6116]">
          <AlertTriangle size={12} aria-hidden="true" /> Differs: {differences.join("; ")}
        </span>
      ) : row.hours === "same" ? (
        <span className="text-[#2e7d55]">the row agrees</span>
      ) : null}
    </div>
  );
}
