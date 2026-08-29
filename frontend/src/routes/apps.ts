import { BookOpen, FileText, Users, type LucideIcon } from "lucide-react";

import { ToolId } from "@/routes/toolRoute";

export type CoordinatorApp = {
  id: ToolId | "handbook";
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
    id: "teachers",
    name: "Part-time Teacher Database",
    description: "Keep teacher profiles, contacts, notes, and teaching-recruitment requests together.",
    icon: FileText,
    keywords: "teacher professor lecturer requisition recruitment contract docx contacts",
  },
  {
    id: "database",
    name: "Students and Timetables",
    description:
      "The student roster and the cohorts, groups and CRNs they are taught in, and the semester timetables students see.",
    icon: Users,
    keywords:
      "student database cohort group crn roster portal registrar assignment scope block " +
      "timetable schedule semester upload publish scen student hub platform announcement notice",
  },
  {
    id: "handbook",
    name: "Coordinator handbook",
    description: "Browse SCEN procedures, onboarding guidance, reference material, and the annual academic cycle.",
    icon: BookOpen,
    keywords: "handbook documentation procedures onboarding grades transcripts",
  },
];
