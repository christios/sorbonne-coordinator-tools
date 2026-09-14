import { BookOpen, Users, type LucideIcon } from "lucide-react";

import { ToolId } from "@/routes/toolRoute";

/** The id an app is known by, in the workspace and in whoever-may-open-it alike. */
export type AppId = ToolId | "handbook";

export type CoordinatorApp = {
  id: AppId;
  name: string;
  description: string;
  icon: LucideIcon;
  keywords: string;
};

/** The workspace, in the order it is offered — to the app picker and the side pane alike. */
export const COORDINATOR_APPS: CoordinatorApp[] = [
  {
    id: "syllabus",
    name: "Syllabus builder",
    description: "Create, revise, compare, and maintain SCEN course syllabi across academic years.",
    icon: BookOpen,
    keywords: "syllabus course template academic year comparison",
  },
  {
    id: "database",
    name: "Students and Timetables",
    description:
      "The student roster and the cohorts, groups and CRNs they are taught in, and the semester timetables students see.",
    icon: Users,
    keywords:
      "student database cohort group crn roster portal registrar assignment scope block " +
      "timetable schedule semester upload publish scen student hub platform announcement notice " +
      "part-time teacher professor lecturer requisition recruitment contract docx contacts time sheet",
  },
  {
    id: "handbook",
    name: "Coordinator handbook",
    description: "Browse SCEN procedures, onboarding guidance, reference material, and the annual academic cycle.",
    icon: BookOpen,
    keywords: "handbook documentation procedures onboarding grades transcripts",
  },
];

/**
 * The apps this person may open, in the workspace's own order.
 *
 * The platform decides; this only reads its answer. Somebody who has been given nothing sees
 * an empty workspace rather than a full one they cannot use — and an empty workspace is a
 * thing they will report, where quietly showing them the student roster is not.
 */
export function appsFor(user: { isAdmin?: boolean; apps?: Partial<Record<AppId, unknown>> } | null): CoordinatorApp[] {
  if (!user) return [];
  if (user.isAdmin) return COORDINATOR_APPS;
  const granted = user.apps ?? {};
  return COORDINATOR_APPS.filter((app) => app.id in granted);
}
