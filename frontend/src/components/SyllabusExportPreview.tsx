import { useQuery } from "@tanstack/react-query";

import { API_BASE_URL, apiFetch } from "@/services/http";

type Resolved = { courseTitle: string; courseCode: string; academicYear: string; content: Record<string, unknown>; sections: string[] };

/**
 * The exported document, before it is a document.
 *
 * It renders the same resolved content the builder is handed, in the approved
 * template's order, so a professor can see what the Provost will receive without
 * downloading it. It is a second rendering of one source, never a second source.
 */
export function SyllabusExportPreview({ syllabusId }: { syllabusId: string }) {
  const preview = useQuery({
    queryKey: ["syllabus-export-preview", syllabusId],
    queryFn: async (): Promise<Resolved> => {
      const response = await apiFetch(`${API_BASE_URL}/api/v1/syllabi/${syllabusId}/export-preview`);
      if (!response.ok) throw new Error("Could not build the preview.");
      return (await response.json()) as Resolved;
    },
  });

  if (preview.isLoading) return <p className="text-sm text-[#667085]">Building the preview…</p>;
  if (preview.error || !preview.data)
    return <p role="alert" className="rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">Could not build the preview.</p>;

  const { content } = preview.data;
  const identification = record(content.identification);
  const contacts = record(content.contacts);
  const outcomes = record(content.learningOutcomes);
  const approach = record(content.teachingApproach);
  const assessment = record(content.assessment);
  const byWeek = text(assessment.scheduleBy) === "week";

  const sections = preview.data.sections ?? [];
  const missing = sections.filter((heading) => !RENDERED.some((prefix) => heading.startsWith(prefix)));

  return (
    <article className="mx-auto max-w-[52rem] rounded-lg border border-[#d9dee7] bg-white p-8 text-[#1f2937] shadow-sm">
      <header className="border-b border-[#d9dee7] pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#a6292f]">Course syllabus</p>
        <h2 className="mt-1 text-2xl font-semibold">{preview.data.courseTitle}</h2>
        <p className="mt-1 text-sm text-[#667085]">{preview.data.courseCode} · {preview.data.academicYear}</p>
      </header>

      {missing.length ? (
        <p role="status" className="mt-4 rounded-md border border-[#f0d8a8] bg-[#fdf8ee] px-3 py-2 text-sm text-[#8a6116]">
          The template also prints {missing.join(", ")}. Those are not shown here yet.
        </p>
      ) : null}

      <Block heading="1. COURSE IDENTIFICATION">
        <Rows rows={[
          ["Programme title", text(identification.programmeTitle)],
          ["Degree level and semester", text(identification.degreeLevelAndSemester)],
          ["Number of ECTS", text(identification.ects)],
          ...Object.entries(record(identification.contactHours)).map(([label, value]) => [`Contact hours — ${label}`, text(value)] as [string, string]),
          ["Prerequisites", listText(identification.prerequisiteItems, identification.prerequisites)],
          ["Co-requisites", listText(identification.corequisiteItems, identification.corequisites)],
          ["Equipment", listText(identification.equipmentItems, identification.equipment)],
        ]} />
      </Block>

      <Block heading="2.1. Course instructor">
        <Rows rows={rows(contacts.instructors, contacts.instructor).map((person, index) => [`Instructor ${index + 1}`, [text(person.Name), text(person["Academic rank / status"]), text(person.Email)].filter(Boolean).join(" · ")] as [string, string])} />
      </Block>
      <Block heading="2.2. Administrative contact point">
        <Rows rows={[["Academic coordinator", [text(record(contacts.administrativeContact).name), text(record(contacts.administrativeContact).contactDetails)].filter(Boolean).join(" · ") || text(contacts.administrativeContact)]]} />
      </Block>

      <Block heading="3. COURSE DESCRIPTION">
        <Prose value={text(record(content.description).overview)} />
      </Block>

      <Block heading="4. COURSE DELIVERY">
        <Rows rows={[
          ["Mode", text(record(content.delivery).mode)],
          ["Face-to-face (%)", text(record(content.delivery).faceToFacePercent)],
          ["Online (%)", text(record(content.delivery).onlinePercent)],
        ]} />
      </Block>

      <Block heading="5.1. Programme Learning Outcomes">
        <Table headers={["Code", "Outcome"]} body={rows(outcomes.plos).map((plo) => [text(plo.code), text(plo.outcome) || text(plo.legacyText)])} />
      </Block>

      <Block heading="5.2. Course learning outcomes linked to programme learning outcomes and Graduate Skills and Competencies">
        <Table
          headers={["Course learning outcome", "Aligned PLO", "SCEN Graduate Competencies", "SUAD Graduate Competencies"]}
          body={rows(outcomes.clos).map((clo, index) => [numbered(text(clo.clo), index), text(clo.plo), text(clo.skills), text(clo.suadSkills)])}
        />
      </Block>

      <Block heading="6. COURSE SCHEDULE">
        <Table headers={["Week", "Session", "Topic", "Assessment", "Date"]} body={sessions(rows(content.schedule))} />
      </Block>

      <Block heading="7. SUPPLEMENTAL BIBLIOGRAPHICAL RESOURCES RECOMMENDED (if any)">
        <Rows rows={[
          ["Books", resources(record(content.bibliography).books)],
          ["Websites", resources(record(content.bibliography).websites)],
          ["Journal articles", resources(record(content.bibliography).articles)],
        ]} />
      </Block>

      <Block heading="8. TEACHING AND LEARNING APPROACH">
        {(["methods", "engagement", "feedback"] as const).map((key) => (
          <div key={key} className="mt-3">
            <p className="text-sm font-semibold">{SUBSECTION[key]}</p>
            <Prose value={text(approach[key])} />
          </div>
        ))}
      </Block>

      <Block heading="9.1. Summary of all course assessments (graded learning activities)">
        <Table
          headers={[byWeek ? "Week" : "Assessment date", "Assessment type", "Weight (%)", "CLO's assessed", "Applicable AI policy"]}
          body={rows(assessment.items).map((item) => [
            byWeek ? text(item.week) : text(item.date),
            text(item.name) || text(item.type),
            text(item.weight),
            cloNumbers(item, rows(outcomes.clos)),
            text(item.aiPolicy) || text(item.ai),
          ])}
        />
      </Block>

      <Block heading="9.2. Table of Grade Equivalence">
        <Prose value={GRADE_EQUIVALENCE} />
      </Block>

      <Block heading="9.3. AI Policy">
        <Rows rows={[
          ["Course-level policy", text(assessment.aiPolicy)],
          ["Additional instructions regarding AI", text(assessment.aiInstructions)],
        ]} />
      </Block>

      <Block heading="9.4. Assessment Methodologies:">
        <Prose value={text(assessment.methodologies)} />
      </Block>

      <Block heading="9.5. Grading Rubrics for Evaluating All Categories of Assignment(s)">
        {rows(assessment.rubrics).length ? rows(assessment.rubrics).map((rubric, index) => (
          <div key={index} className="mt-4">
            <p className="text-sm font-semibold">Assessment type: {text(rubric.assignment)}</p>
            <Table
              headers={["Criteria", "Inadequate (0–9 points)", "Meets expectations (10–15 points)", "Exceeds expectations (16–20 points)"]}
              body={rows(rubric.criteria).map((criterion) => [text(criterion.criterion), text(criterion.inadequate), text(criterion.meets), text(criterion.exceeds)])}
            />
          </div>
        )) : <p className="mt-2 text-sm text-[#667085]">No rubric yet.</p>}
      </Block>

      <Block heading="9.6. Late submission policy:">
        <Prose value={text(assessment.lateSubmissionPolicy)} />
      </Block>

      <Block heading="INTEGRITY POLICY">
        <p className="mt-2 text-sm text-[#667085]">Printed by the template, the same in every syllabus.</p>
      </Block>
      <Block heading="CLASSROOM ETIQUETTE">
        <p className="mt-2 text-sm text-[#667085]">Printed by the template, the same in every syllabus.</p>
      </Block>

      <Block heading="DOCUMENT CONTROL">
        <Rows rows={[
          ["Document creation date", text(record(content.documentControl).creationDate)],
          ["Department name", text(record(content.documentControl).department)],
          ["Syllabus approval date", text(record(content.documentControl).approvalDate)],
          ["Version number", text(record(content.documentControl).version)],
          ["Name and status of the approver", text(record(content.documentControl).approver)],
        ]} />
      </Block>
    </article>
  );
}

/** Section headings the preview renders, matched against the template's own list. */
export const RENDERED = [
  "COURSE IDENTIFICATION", "ACADEMIC CONTACTS", "2.1.", "2.2.", "COURSE DESCRIPTION", "COURSE DELIVERY",
  "LEARNING OUTCOMES", "5.1.", "5.2.", "COURSE SCHEDULE", "SUPPLEMENTAL BIBLIOGRAPHICAL RESOURCES",
  "TEACHING AND LEARNING APPROACH", "8.1.", "8.2.", "8.3.", "COURSE ASSESSMENT", "9.1.", "9.2.", "9.3.",
  "9.4.", "9.5.", "9.6.", "INTEGRITY POLICY", "CLASSROOM ETIQUETTE", "DOCUMENT CONTROL",
];

const GRADE_EQUIVALENCE =
  "SUAD uses the French grading system, in which grades are awarded on a scale from 0 to 20, with 0 representing the lowest achievable mark.";

function Prose({ value }: { value: string }) {
  return <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#374151]">{value || "—"}</p>;
}

function listText(items: unknown, legacy: unknown) {
  if (Array.isArray(items)) return items.map((item) => text(record(item).text)).filter(Boolean).join("\n");
  return text(legacy);
}

function resources(value: unknown) {
  return rows(value).map((item) => [text(item.title), text(item.authors), text(item.freeformText), text(item.legacyText)].filter(Boolean).join(" · ")).filter(Boolean).join("\n");
}

const SUBSECTION = {
  methods: "8.1 Teaching methods and learning activities",
  engagement: "8.2 Student engagement",
  feedback: "8.3 Feedback and academic progress",
} as const;

/** Sessions are counted within their kind, exactly as the document counts them. */
function sessions(schedule: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>();
  return schedule.map((row) => {
    const kind = text(row.sessionType) || "CM";
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    const topic = [text(row.topic), text(row.details)].filter(Boolean).join("\n");
    const detail = [text(row.preClass), text(row.assessments)].filter(Boolean).join("\n");
    return [text(row.week), `${kind} ${next}`, topic, detail, text(row.deadline)];
  });
}

function numbered(value: string, index: number) {
  if (!value) return "";
  return /^\s*CLO\s*\d/i.test(value) ? value : `CLO ${index + 1}: ${value}`;
}

function cloNumbers(item: Record<string, unknown>, clos: Array<Record<string, unknown>>) {
  const ids = Array.isArray(item.cloIds) ? (item.cloIds as string[]) : [];
  const numbers = ids
    .map((id) => clos.findIndex((clo) => clo.id === id))
    .filter((position) => position >= 0)
    .map((position) => `CLO ${position + 1}`);
  return numbers.join(", ");
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return <section className="mt-6"><h3 className="text-base font-semibold text-[#111827]">{heading}</h3>{children}</section>;
}

function Rows({ rows: entries }: { rows: Array<[string, string]> }) {
  const filled = entries.filter(([, value]) => value);
  if (!filled.length) return <p className="mt-2 text-sm text-[#667085]">—</p>;
  return <dl className="mt-2 grid gap-1 text-sm">{filled.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,14rem)_1fr] gap-3"><dt className="text-[#667085]">{label}</dt><dd className="whitespace-pre-line">{value}</dd></div>)}</dl>;
}

function Table({ headers, body }: { headers: string[]; body: string[][] }) {
  const filled = body.filter((row) => row.some(Boolean));
  if (!filled.length) return <p className="mt-2 text-sm text-[#667085]">Nothing yet.</p>;
  return <div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead><tr>{headers.map((header) => <th key={header} className="border border-[#d9dee7] bg-[#f8fafc] px-2 py-1 font-semibold">{header}</th>)}</tr></thead><tbody>{filled.map((row, index) => <tr key={index} className="align-top">{row.map((cell, position) => <td key={position} className="whitespace-pre-line border border-[#d9dee7] px-2 py-1">{cell}</td>)}</tr>)}</tbody></table></div>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rows(...values: unknown[]): Array<Record<string, unknown>> {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
    if (value && typeof value === "object" && !Array.isArray(value)) return [value as Record<string, unknown>];
  }
  return [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}
