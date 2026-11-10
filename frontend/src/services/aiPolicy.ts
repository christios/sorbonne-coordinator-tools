/**
 * AI policy, per graded activity (November 2026 review).
 *
 * Every graded activity applies one of the five options of the template's AI table
 * (section 9.3). The rules here are the backend's (syllabus_content.py) — the screen, the
 * preview and the document must agree on which options a syllabus uses.
 */
import type { CatalogueEntry } from "@/services/syllabusCatalogues";

export const AI_OPTIONS = [
  "AI Prohibited",
  "AI Permitted as a Support Tool",
  "Restricted AI Use",
  "AI Required",
  "Other (Specify)",
] as const;
export type AiOptionLabel = (typeof AI_OPTIONS)[number];
export const OTHER_AI_OPTION: AiOptionLabel = "Other (Specify)";

/** The template's own wording of the uses a course may tick, if the catalogue has none. */
export const TEMPLATE_PERMITTED_USES = [
  "Brainstorming or generating initial ideas",
  "Language editing (grammar, spelling, style, and readability)",
  "Structuring or organizing ideas",
  "Clarifying concepts or obtaining explanations",
];

const LEGACY_PERMITTED_USES: Record<string, string> = {
  "language editing": "Language editing (grammar, spelling, style, and readability)",
  "structuring or organising ideas": "Structuring or organizing ideas",
};

export type AiOption = {
  id: string;
  label: AiOptionLabel;
  row: number;
  wording: string;
  permittedUses: string[];
};

type Activity = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function folded(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ").toLocaleLowerCase();
}

/** The template option a stored label names, or "" when it names none of them. */
export function aiOption(label: unknown): AiOptionLabel | "" {
  const wanted = folded(text(label));
  return AI_OPTIONS.find((option) => option.toLocaleLowerCase() === wanted) ?? "";
}

/** The catalogue's five, in the template's order — or the template's own labels before it loads. */
export function aiOptions(catalogue: CatalogueEntry[]): AiOption[] {
  return AI_OPTIONS.map((label, index) => {
    const entry = catalogue.find((item) => !item.isRetired && aiOption(item.label) === label);
    const uses = Array.isArray(entry?.payload.permittedUses)
      ? (entry.payload.permittedUses as unknown[]).filter((use): use is string => typeof use === "string")
      : label === "AI Permitted as a Support Tool" ? TEMPLATE_PERMITTED_USES : [];
    return { id: entry?.id ?? "", label, row: index + 1, wording: text(entry?.payload.description) || text(entry?.payload.details), permittedUses: uses };
  });
}

/** The option an activity applies: its own, or the one course-level policy older syllabi set. */
export function activityAiPolicy(activity: Activity, assessment: Record<string, unknown>): { label: string; inherited: boolean } {
  const own = text(activity.aiPolicy) || text(activity.ai);
  if (own) return { label: own, inherited: false };
  const course = text(assessment.aiPolicy);
  return { label: course, inherited: Boolean(course) };
}

/** What the 9.1 summary prints in the activity's "Applicable AI policy" column. */
export function aiPolicySummary(activity: Activity, assessment: Record<string, unknown>): string {
  const { label } = activityAiPolicy(activity, assessment);
  if (aiOption(label) === OTHER_AI_OPTION) {
    const written = text(activity.aiOtherText);
    return written ? `Other: ${written}` : label;
  }
  return label;
}

/** The template options at least one graded activity applies, in the template's order. */
export function aiOptionsInUse(activities: Activity[], assessment: Record<string, unknown>): AiOptionLabel[] {
  const used = new Set(activities.map((activity) => aiOption(activityAiPolicy(activity, assessment).label)));
  return AI_OPTIONS.filter((option) => used.has(option));
}

/** A permitted use as the template words it. */
export function templatePermittedUse(use: string): string {
  return LEGACY_PERMITTED_USES[folded(use)] ?? use;
}
