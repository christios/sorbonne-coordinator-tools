/**
 * Section 8, the teaching and learning approach, follows from the course schedule (Christian,
 * 10 Nov 2026). The department writes a text for each kind of session (Manage catalogues →
 * Teaching presets); a syllabus prints the texts for the kinds its schedule uses.
 *
 * A preset names what brings it in: session types, or graded activities of an assessment
 * type. One that names nothing is matched by its own name, so the department's existing
 * texts work as they are — lectures ← CM, problem-solving/TD ← TD, laboratory/TP ← TP,
 * project ← graded activities of a project type. The backend's preset_triggers says the same.
 */
import type { CatalogueEntry } from "@/services/syllabusCatalogues";

export const DEFAULT_SESSION = "CM";

const SESSION_WORDS: Array<[string, RegExp]> = [
  ["CM", /lecture|cours magistr|\bCM\b/i],
  ["TD", /tutorial|problem[- ]solving|travaux dirig|\bTD\b/i],
  ["TP", /laborator|travaux pratiques|\bTP\b/i],
  ["Workshop", /workshop/i],
  ["Seminar", /seminar/i],
];
const PROJECT = /project/i;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export type PresetTriggers = { sessionTypes: string[]; assessmentTypeIds: string[]; projectByName: boolean };

/** What brings a preset into a syllabus. */
export function presetTriggers(preset: Pick<CatalogueEntry, "label" | "payload">): PresetTriggers {
  const payload = preset.payload ?? {};
  if ("sessionTypes" in payload || "assessmentTypeIds" in payload)
    return { sessionTypes: strings(payload.sessionTypes), assessmentTypeIds: strings(payload.assessmentTypeIds), projectByName: false };
  const sessionTypes = SESSION_WORDS.filter(([, words]) => words.test(preset.label)).map(([session]) => session);
  return { sessionTypes, assessmentTypeIds: [], projectByName: !sessionTypes.length && PROJECT.test(preset.label) };
}

type Card = Record<string, unknown>;

/** The session types the schedule uses, and its graded activities' assessment types. */
export function scheduleKinds(schedule: Card[]) {
  const sessionTypes = new Set(schedule.filter((row) => row.kind !== "graded").map((row) => String(row.sessionType || DEFAULT_SESSION)));
  const graded = schedule.filter((row) => row.kind === "graded");
  const typeIds = new Set(graded.map((row) => String(row.assessmentTypeId ?? "")).filter(Boolean));
  const typeNames = new Set(graded.map((row) => String(row.type ?? "").trim()).filter(Boolean));
  return { sessionTypes, typeIds, typeNames };
}

/** The department's texts this schedule brings into section 8, in the catalogue's order. */
export function presetsForSchedule(presets: CatalogueEntry[], schedule: Card[]): CatalogueEntry[] {
  const kinds = scheduleKinds(schedule);
  return presets.filter((preset) => {
    if (preset.isRetired) return false;
    const wanted = presetTriggers(preset);
    if (wanted.sessionTypes.some((type) => kinds.sessionTypes.has(type))) return true;
    if (wanted.assessmentTypeIds.some((id) => kinds.typeIds.has(id))) return true;
    return wanted.projectByName && [...kinds.typeNames].some((name) => PROJECT.test(name));
  });
}
