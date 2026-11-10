export type ResourceEntry = {
  id: string;
  entryMode?: "structured" | "freeform";
  legacyText?: string;
  freeformText?: string;
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

export function ploDisplayLabel(entry: PloEntry, index: number): string {
  const outcome = (entry.legacyText ?? entry.outcome ?? "")
    .replace(new RegExp(`^PLO\\s*${index + 1}\\s*[:.]?\\s*`, "i"), "")
    .trim();
  return outcome ? `PLO ${index + 1}: ${outcome}` : `PLO ${index + 1}`;
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

/** Content written since November 2026 keeps its graded activities in the schedule. */
export const SCHEDULE_HOLDS_GRADED_ACTIVITIES = 2;

export function schemaVersion(content: Record<string, unknown>): number {
  return typeof content.schemaVersion === "number" ? content.schemaVersion : 1;
}

/**
 * The syllabus's graded activities, wherever this syllabus keeps them: the schedule's graded
 * cards (schemaVersion 2), or `assessment.items` on a syllabus written before. Every feature
 * that needs them asks here (as the backend's graded_activities does), so the move happens once.
 */
export function gradedActivities(content: Record<string, unknown>): AssessmentEntry[] {
  if (schemaVersion(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES) {
    return sortGraded(objectEntries<AssessmentEntry>(content.schedule, "legacy-session").filter((card) => card.kind === "graded"));
  }
  const assessment = isRecord(content.assessment) ? content.assessment : {};
  return assessmentEntries(assessment.items);
}

export type RubricInUse = {
  id: string;
  label: string;
  criteria: Array<{ name: string; inadequate: string; meets: string; exceeds: string }>;
};

/**
 * The rubrics a syllabus prints: one per kind of graded activity it has, as the export does
 * (resolve_rubrics). A catalogue assessment type brings its approved rubric; a rubric an
 * older syllabus wrote by hand is kept only while an activity of that kind still exists.
 */
export function rubricsInUse(
  activities: AssessmentEntry[],
  writtenRubrics: unknown,
  assessmentTypes: Array<{ id: string; label: string; payload: Record<string, unknown> }>,
): RubricInUse[] {
  const used: string[] = [];
  const typed: string[] = [];
  for (const entry of activities) {
    const typeId = typeof entry.assessmentTypeId === "string" ? entry.assessmentTypeId : "";
    if (typeId) {
      if (!used.includes(typeId)) used.push(typeId);
      continue;
    }
    const kind = normalisedKind(entry.type);
    if (kind && !typed.includes(kind)) typed.push(kind);
  }
  const fromCatalogue = used.flatMap((id) => {
    const type = assessmentTypes.find((item) => item.id === id);
    if (!type) return [];
    const criteria = Array.isArray(type.payload.criteria) ? (type.payload.criteria as Array<Record<string, unknown>>) : [];
    return [{ id: type.id, label: type.label, criteria: criteria.map((item) => ({ name: text(item.name), inadequate: text(item.inadequate), meets: text(item.meets), exceeds: text(item.exceeds) })) }];
  });
  const written = new Map(rubricEntries(writtenRubrics).map((rubric) => [normalisedKind(rubric.assignment), rubric]));
  const byHand = typed.flatMap((kind) => {
    const rubric = written.get(kind);
    return rubric ? [{ id: rubric.id, label: rubric.assignment ?? "", criteria: rubric.criteria.map((item) => ({ name: text(item.criterion), inadequate: text(item.inadequate), meets: text(item.meets), exceeds: text(item.exceeds) })) }] : [];
  });
  return [...fromCatalogue, ...byHand];
}

function normalisedKind(value: unknown): string {
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ").toLocaleLowerCase() : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
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

/**
 * The stored content parts one screen section edits, in the order the document prints
 * them. Description and delivery became one section in November 2026 while keeping
 * their own keys, so history and older syllabi are unaffected.
 */
export function sectionParts(
  sections: Array<{ id: string; parts?: string[] }>,
  active: string,
): string[] {
  const section = sections.find((item) => item.id === active);
  return section?.parts?.length ? section.parts : [active];
}

function weekOrder(row: Record<string, unknown>): number {
  const week = typeof row.week === "string" ? row.week.trim() : typeof row.week === "number" ? String(row.week) : "";
  return /^\d+$/.test(week) ? Number(week) : Number.POSITIVE_INFINITY;
}

/** Graded activities in the order the schedule shows them: by week, then by date, undated last. */
function sortGraded<T extends Record<string, unknown>>(cards: T[]): T[] {
  const dateOf = (card: T) => (typeof card.date === "string" ? card.date : "");
  return [...cards].sort((left, right) =>
    weekOrder(left) - weekOrder(right) ||
    Number(!dateOf(left)) - Number(!dateOf(right)) ||
    dateOf(left).localeCompare(dateOf(right)));
}

function displayDate(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text.slice(8, 10)}/${text.slice(5, 7)}/${text.slice(0, 4)}` : text;
}

function lines(...parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === "string" && Boolean(part.trim())).map((part) => part.trim()).join("\n");
}

export type PrintedScheduleRow = Record<string, unknown> & { session: string; ownRow?: boolean };

/**
 * The course schedule as the document prints it (document_schedule on the server): each row
 * with the session label it shows. Once the schedule holds the graded activities, sessions go
 * in week order and each graded activity joins the last session of its week, or has a row
 * of its own in a week with no session.
 */
export function documentSchedule(content: Record<string, unknown>): PrintedScheduleRow[] {
  const stored = (Array.isArray(content.schedule) ? content.schedule : []).filter(isRecord);
  const converted = schemaVersion(content) >= SCHEDULE_HOLDS_GRADED_ACTIVITIES;
  let sessions = converted ? stored.filter((row) => row.kind !== "graded") : stored;
  if (converted) sessions = [...sessions].sort((left, right) => weekOrder(left) - weekOrder(right));
  const counts = new Map<string, number>();
  const printed: PrintedScheduleRow[] = sessions.map((row) => {
    const kind = (typeof row.sessionType === "string" && row.sessionType.trim()) || "CM";
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return { ...row, session: `${kind} ${next}` };
  });
  if (!converted) return printed;
  for (const card of sortGraded(stored.filter((row) => row.kind === "graded"))) {
    const name = (typeof card.name === "string" && card.name.trim()) || (typeof card.type === "string" && card.type.trim()) || "Graded activity";
    const when = displayDate(card.date);
    const week = typeof card.week === "string" ? card.week.trim() : "";
    const home = [...printed].reverse().find((row) => !row.ownRow && week && String(row.week ?? "").trim() === week);
    if (!home) {
      printed.push({ week, session: "", topic: name, ownRow: true, assessments: name, deadline: when });
      continue;
    }
    home.assessments = lines(home.assessments, name);
    home.deadline = lines(home.deadline, when);
  }
  return [...printed].sort((left, right) => weekOrder(left) - weekOrder(right));
}

type ScheduleCard = Record<string, unknown> & { id: string };

/**
 * Cards in the order the schedule is read: by week; in a week, its sessions as they were
 * placed, then its graded activities by date (an undated one last). Nobody drags them.
 */
export function scheduleOrder<T extends ScheduleCard>(cards: T[]): T[] {
  const dateOf = (card: T) => String(card.date ?? "");
  return cards
    .map((card, position) => ({ card, position }))
    .sort((left, right) =>
      weekOrder(left.card) - weekOrder(right.card) ||
      Number(left.card.kind === "graded") - Number(right.card.kind === "graded") ||
      (left.card.kind === "graded"
        ? Number(!dateOf(left.card)) - Number(!dateOf(right.card)) || dateOf(left.card).localeCompare(dateOf(right.card))
        : 0) ||
      left.position - right.position)
    .map(({ card }) => card);
}
