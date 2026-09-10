/**
 * What a syllabus says, section by section, independent of how it is drawn.
 *
 * The exported document reduces to this shape too (see syllabus_projection.py), so
 * a test holds the two against each other cell by cell rather than trusting that
 * the preview and the document agree.
 */
export type Projection = Record<string, string[][]>;

type Syllabus = {
  courseTitle: string;
  courseCode: string;
  academicYear: string;
  content: Record<string, unknown>;
};

export function previewProjection(syllabus: Syllabus): Projection {
  const content = syllabus.content;
  const identification = record(content.identification);
  const contacts = record(content.contacts);
  const outcomes = record(content.learningOutcomes);
  const assessment = record(content.assessment);
  const delivery = record(content.delivery);
  const bibliography = record(content.bibliography);
  const byWeek = text(assessment.scheduleBy) === "week";
  const clos = rows(outcomes.clos);

  return {
    identification: pairs([
      ["Academic Year", syllabus.academicYear],
      ["Course Title", syllabus.courseTitle],
      ["Course Code", syllabus.courseCode],
      ["Degree Level and Semester", text(identification.degreeLevelAndSemester)],
      ["Programme Title", text(identification.programmeTitle)],
      ["Number of ECTS", text(identification.ects)],
      ["Prerequisites and Co-requisites (if any)", joined([
        listText(identification.prerequisiteItems, identification.prerequisites),
        listText(identification.corequisiteItems, identification.corequisites),
      ])],
      ["Equipment (if any)", listText(identification.equipmentItems, identification.equipment)],
    ]),
    instructor: pairs([
      ["Name", instructorLine(contacts, "Name")],
      ["Academic Rank / Status", instructorLine(contacts, "Academic rank / status")],
      ["Email", instructorLine(contacts, "Email")],
    ]),
    coordinator: cell(coordinatorText(contacts)),
    description: cell(text(record(content.description).overview)),
    delivery: [[
      text(delivery.mode) === "Face-to-Face Delivery" ? "☒" : "",
      percentage(delivery.faceToFacePercent),
      percentage(delivery.onlinePercent),
    ]],
    plos: rows(outcomes.plos).map((plo) => [text(plo.code), text(plo.outcome) || text(plo.legacyText)]),
    clos: clos.map((clo, index) => [numbered(text(clo.clo), index), text(clo.plo), text(clo.skills), text(clo.suadSkills)]),
    schedule: schedule(rows(content.schedule)),
    bibliography: pairs([
      ["Books", resources(bibliography.books)],
      ["Websites", resources(bibliography.websites)],
      ["Journal Articles", resources(bibliography.articles)],
    ]),
    assessments: rows(assessment.items).map((item) => [
      byWeek ? text(item.week) : displayDate(item.date),
      text(item.name) || text(item.type),
      percentage(item.weight),
      cloNumbers(item, clos),
      text(item.aiPolicy) || text(item.ai),
    ]),
    rubrics: rows(assessment.rubrics).flatMap((rubric) =>
      rows(rubric.criteria).map((criterion) => [
        text(rubric.assignment),
        text(criterion.criterion),
        text(criterion.inadequate),
        text(criterion.meets),
        text(criterion.exceeds),
      ]),
    ),
  };
}

/** The document writes each session's own detail beside its topic. */
function schedule(sessions: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>();
  return sessions.map((row) => {
    const kind = text(row.sessionType) || "CM";
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    const detail = [
      text(row.preClass) ? `Pre-class learning activities: ${text(row.preClass)}` : "",
      text(row.assessments) ? `Assessments: ${text(row.assessments)}` : "",
    ].filter(Boolean).join(" ");
    return [
      text(row.week),
      `${kind} ${next}`,
      collapse([text(row.topic), text(row.details)].filter(Boolean).join(" ")),
      collapse(detail),
      text(row.deadline),
    ];
  });
}

function instructorLine(contacts: Record<string, unknown>, key: string) {
  return rows(contacts.instructors, contacts.instructor).map((person) => text(person[key])).filter(Boolean).join(" ");
}

function coordinatorText(contacts: Record<string, unknown>) {
  const admin = contacts.administrativeContact;
  if (typeof admin === "string") return collapse(admin);
  const value = record(admin);
  return collapse([
    text(value.name) ? `Name: ${text(value.name)}` : "",
    text(value.contactDetails) ? `Contact details: ${text(value.contactDetails)}` : "",
  ].filter(Boolean).join(" "));
}

/** The document prints a date as it is read aloud, not as it is stored. */
function displayDate(value: unknown) {
  const stored = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stored);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : stored;
}

function percentage(value: unknown) {
  const stored = text(value);
  return stored && !stored.endsWith("%") ? `${stored}%` : stored;
}

function numbered(value: string, index: number) {
  if (!value) return "";
  return /^\s*CLO\s*\d/i.test(value) ? value : `CLO ${index + 1}: ${value}`;
}

function cloNumbers(item: Record<string, unknown>, clos: Array<Record<string, unknown>>) {
  const ids = Array.isArray(item.cloIds) ? (item.cloIds as string[]) : [];
  return ids
    .map((id) => clos.findIndex((clo) => clo.id === id))
    .filter((position) => position >= 0)
    .map((position) => `CLO ${position + 1}`)
    .join(", ");
}

function resources(value: unknown) {
  return collapse(rows(value)
    .map((item) => [text(item.freeformText), text(item.legacyText), text(item.title)].find(Boolean) ?? "")
    .filter(Boolean)
    .join(" "));
}

function listText(items: unknown, legacy: unknown) {
  if (Array.isArray(items)) return collapse(items.map((item) => text(record(item).text)).filter(Boolean).join(" "));
  return collapse(text(legacy));
}

function joined(parts: string[]) {
  return parts.filter(Boolean).join(" ");
}

function pairs(entries: Array<[string, string]>) {
  return entries.filter(([, value]) => value).map(([label, value]) => [label, collapse(value)]);
}

function cell(value: string) {
  return [[collapse(value)]];
}

function collapse(value: string) {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rows(...values: unknown[]): Array<Record<string, unknown>> {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    }
    if (value && typeof value === "object" && !Array.isArray(value)) return [value as Record<string, unknown>];
  }
  return [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
