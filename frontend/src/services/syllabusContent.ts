export type ResourceEntry = {
  id: string;
  legacyText?: string;
  authors?: string;
  title?: string;
  year?: string;
  edition?: string;
  publisher?: string;
  isbn?: string;
  organisation?: string;
  url?: string;
  accessedDate?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
};

export type PloEntry = { id: string; code?: string; outcome?: string; legacyText?: string };

export type ScheduleEntry = Record<string, string> & { id: string; preClass?: string; assessments?: string };
export type AssessmentEntry = Record<string, string | string[]> & { id: string; cloIds?: string[] };
export type RubricCriterion = { id: string; criterion?: string; inadequate?: string; meets?: string; exceeds?: string };
export type Rubric = { id: string; assignment?: string; criteria: RubricCriterion[] };

export function bibliographyEntries(value: unknown): ResourceEntry[] {
  return objectEntries<ResourceEntry>(value, "legacy-resource");
}

export function ploEntries(value: unknown): PloEntry[] {
  return objectEntries<PloEntry>(value, "legacy-plo");
}

export function scheduleEntries(value: unknown): ScheduleEntry[] {
  return objectEntries<ScheduleEntry>(value, "legacy-session");
}

export function assessmentEntries(value: unknown): AssessmentEntry[] {
  return objectEntries<AssessmentEntry>(value, "legacy-assessment");
}

export function rubricEntries(value: unknown): Rubric[] {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, Rubric>();
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (Array.isArray(item.criteria)) {
      const rubric = item as unknown as Rubric;
      grouped.set(rubric.id || `legacy-rubric-${index}`, { ...rubric, id: rubric.id || `legacy-rubric-${index}`, criteria: rubric.criteria.map((criterion, criterionIndex) => ({ ...criterion, id: criterion.id || `legacy-criterion-${index}-${criterionIndex}` })) });
      return;
    }
    const flat = item as Record<string, string>;
    const assignment = flat.assignment ?? "Untitled assessment";
    const rubric = grouped.get(assignment) ?? { id: `legacy-rubric-${index}`, assignment, criteria: [] };
    rubric.criteria.push({ id: flat.id || `legacy-criterion-${index}`, criterion: flat.criteria, meets: flat.meets, exceeds: flat.exceeds });
    grouped.set(assignment, rubric);
  });
  return [...grouped.values()];
}

export function deliveryPercentageError(faceToFace: string, online: string): string | null {
  const values = [faceToFace, online].filter((value) => value.trim() !== "");
  if (values.some((value) => !/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 0 || Number(value) > 100)) {
    return "Delivery percentages must be between 0 and 100.";
  }
  if (values.length === 2 && Number(faceToFace) + Number(online) !== 100) {
    return "Face-to-face and online delivery must total 100%.";
  }
  return null;
}

function objectEntries<T extends { id: string; legacyText?: string }>(value: unknown, legacyPrefix: string): T[] {
  if (typeof value === "string") return value.trim() ? [{ id: `${legacyPrefix}-0`, legacyText: value } as T] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string") return item.trim() ? [{ id: `${legacyPrefix}-${index}`, legacyText: item } as T] : [];
    if (!isRecord(item)) return [];
    return [{ ...item, id: typeof item.id === "string" ? item.id : `${legacyPrefix}-${index}` } as T];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
