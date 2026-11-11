import { useQuery } from "@tanstack/react-query";

import { API_BASE_URL, apiFetch } from "@/services/http";
import { previewProjection } from "@/services/syllabusProjection";
import { OTHER_AI_OPTION, activityAiPolicy, aiOption, courseAiFallback, templatePermittedUse } from "@/services/aiPolicy";
import { CONTACT_HOUR_ROWS, contactHours, gradedActivities } from "@/services/syllabusContent";

type Resolved = { courseTitle: string; courseCode: string; academicYear: string; content: Record<string, unknown>; sections: string[] };

/*
 * The approved template's look (10 Nov 2026: the preview should look like the document).
 * Taken from the template itself: Arial throughout, dark navy text, red section titles on a
 * grey band, navy sub-headings, and red-ruled tables whose label cells are dark navy with
 * white bold text.
 */
const DOC = {
  font: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  ink: "#0A1D30",
  navy: "#002060",
  red: "#FF0000",
  band: "#D9D9D9",
  label: "#0A1D30",
} as const;

/**
 * The exported document, before it is a document.
 *
 * It renders the same resolved content the builder is handed, in the approved
 * template's order and dressed as the template is, so a professor can see what the
 * Provost will receive without downloading it. It is a second rendering of one source,
 * never a second source.
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
  const approach = record(content.teachingApproach);
  const assessment = record(content.assessment);
  const delivery = record(content.delivery);
  const byWeek = text(assessment.scheduleBy) === "week";
  const hours = contactHours(content);
  const coordinator = record(contacts.administrativeContact);

  // The tables below render the very data the parity test compares to the document.
  const projection = previewProjection(preview.data);
  const sections = preview.data.sections ?? [];
  const missing = sections.filter((heading) => !RENDERED.some((prefix) => heading.startsWith(prefix)));

  return (
    <article
      className="mx-auto max-w-[52rem] bg-white px-6 py-8 shadow-sm ring-1 ring-[#d9dee7] sm:px-12"
      style={{ fontFamily: DOC.font, color: DOC.ink, fontSize: "13px", lineHeight: 1.4 }}
    >
      <header>
        <img src="/assets/logos/suad-syllabus-logo.png" alt="Sorbonne University Abu Dhabi" className="h-20 w-auto" />
        <p className="mt-6 text-center text-lg font-bold" style={{ color: DOC.navy }}>COURSE SYLLABUS</p>
      </header>

      {missing.length ? (
        <p role="status" className="mt-4 rounded-md border border-[#f0d8a8] bg-[#fdf8ee] px-3 py-2 text-sm text-[#8a6116]" style={{ fontFamily: "inherit" }}>
          The template also prints {missing.join(", ")}. Those are not shown here yet.
        </p>
      ) : null}

      <Section heading="1. COURSE IDENTIFICATION">
        <LabelTable rows={[
          ["Academic Year", preview.data.academicYear],
          ["Course Title", preview.data.courseTitle],
          ["Course Code", preview.data.courseCode],
          ["Degree Level and Semester", text(identification.degreeLevelAndSemester)],
          ["Programme Title", text(identification.programmeTitle)],
          ["Number of ECTS", text(identification.ects)],
          ["Course Contact Hours", <ContactHours key="hours" hours={hours} />],
          ["Prerequisites and Co-requisites (if any)", [listText(identification.prerequisiteItems, identification.prerequisites), listText(identification.corequisiteItems, identification.corequisites)].filter(Boolean).join("\n")],
          ["Equipment (if any)", listText(identification.equipmentItems, identification.equipment)],
        ]} />
      </Section>

      <Section heading="2. ACADEMIC CONTACTS">
        <SubHeading>2.1. Course instructor</SubHeading>
        {rows(contacts.instructors, contacts.instructor).map((person, index) => (
          <LabelTable key={index} rows={[
            ["Name", text(person.Name)],
            ["Academic Rank / Status", text(person["Academic rank / status"]) || text(person["Academic Rank / Status"])],
            ["Affiliation(s)", text(person["Affiliation(s)"])],
            ["Office Hours and Location", text(person["Office hours and location"])],
            ["Email", text(person.Email)],
          ]} />
        ))}
        <SubHeading>2.2. Administrative contact point</SubHeading>
        <LabelTable rows={[["Academic Coordinator", [text(coordinator.name), text(coordinator.contactDetails)].filter(Boolean).join("\n") || text(contacts.administrativeContact)]]} />
      </Section>

      <Section heading="3. COURSE DESCRIPTION">
        <Box value={text(record(content.description).overview)} />
      </Section>

      <Section heading="4. COURSE DELIVERY">
        <DeliveryTable mode={text(delivery.mode)} faceToFace={percentage(delivery.faceToFacePercent)} online={percentage(delivery.onlinePercent)} />
      </Section>

      <Section heading="5. LEARNING OUTCOMES">
        <SubHeading>5.1. Programme Learning Outcomes</SubHeading>
        <LabelTable title="Programme Learning Outcomes." rows={projection.plos.map(([code, outcome]): [string, string] => [code, outcome])} />
        <SubHeading>5.2. Course learning outcomes linked to programme learning outcomes and Graduate Skills and Competencies</SubHeading>
        <GridTable
          headers={["Course Learning Outcome (CLO)", "Aligned Programme Learning Outcome (PLO)", "SCEN Graduate Competencies", "SUAD Graduate Competencies"]}
          body={projection.clos}
          boldFirstColumn
        />
      </Section>

      <Section heading="6. COURSE SCHEDULE">
        <GridTable headers={["Week", "Session", "Topic", "Assessment", "Date"]} body={projection.schedule} />
      </Section>

      <Section heading="7. SUPPLEMENTAL BIBLIOGRAPHICAL RESOURCES RECOMMENDED (if any)">
        <LabelTable rows={[
          ["Books", resources(record(content.bibliography).books)],
          ["Websites", resources(record(content.bibliography).websites)],
          ["Journal articles", resources(record(content.bibliography).journalArticles)],
        ]} />
      </Section>

      <Section heading="8. TEACHING AND LEARNING APPROACH">
        {(["methods", "engagement", "feedback"] as const).map((key) => (
          <div key={key}>
            <SubHeading>{SUBSECTION[key]}</SubHeading>
            <Box value={text(approach[key])} />
          </div>
        ))}
      </Section>

      <Section heading="9. COURSE ASSESSMENT">
        <SubHeading>9.1. Summary of all course assessments (graded learning activities)</SubHeading>
        <GridTable
          headers={[byWeek ? "Week" : "Assessment date", "Assessment type", "Weight (%)", "CLO's assessed", "Applicable AI policy"]}
          body={projection.assessments}
        />

        <SubHeading>9.2. Table of Grade Equivalence</SubHeading>
        <Box value={GRADE_EQUIVALENCE} />

        <SubHeading>9.3. AI Policy</SubHeading>
        {/* Ticked as the document ticks them: every option a graded activity applies. */}
        <LabelTable rows={[
          ...projection.aiOptions.map(([option]): [string, string] => [`☒ ${option}`, aiOptionDetails(option, assessment, gradedActivities(content), courseAiFallback(content))]),
          ["Additional instructions regarding AI", text(assessment.aiInstructions)],
        ]} />

        <SubHeading>9.4. Assessment Methodologies:</SubHeading>
        <Box value={text(assessment.methodologies)} />

        <SubHeading>9.5. Grading Rubrics for Evaluating All Categories of Assignment(s)</SubHeading>
        {rows(assessment.rubrics).length ? rows(assessment.rubrics).map((rubric, index) => (
          <div key={index}>
            <p className="mt-3 font-bold" style={{ color: DOC.navy }}>Assessment type: {text(rubric.assignment)}</p>
            <GridTable
              headers={["Criteria", "Inadequate (0–9 points)", "Meets expectations (10–15 points)", "Exceeds expectations (16–20 points)"]}
              body={projection.rubrics.filter((row) => row[0] === text(rubric.assignment)).map((row) => row.slice(1))}
              boldFirstColumn
            />
          </div>
        )) : <Box value="" />}

        <SubHeading>9.6. Late submission policy:</SubHeading>
        <Box value={text(assessment.lateSubmissionPolicy)} />
      </Section>

      <Section heading="INTEGRITY POLICY">
        <p className="mt-2 italic text-[#667085]">Printed by the template, the same in every syllabus.</p>
      </Section>
      <Section heading="CLASSROOM ETIQUETTE">
        <p className="mt-2 italic text-[#667085]">Printed by the template, the same in every syllabus.</p>
      </Section>
    </article>
  );
}

/** Section headings the preview renders, matched against the template's own list. */
export const RENDERED = [
  "COURSE IDENTIFICATION", "ACADEMIC CONTACTS", "2.1.", "2.2.", "COURSE DESCRIPTION", "COURSE DELIVERY",
  "LEARNING OUTCOMES", "5.1.", "5.2.", "COURSE SCHEDULE", "SUPPLEMENTAL BIBLIOGRAPHICAL RESOURCES",
  "TEACHING AND LEARNING APPROACH", "8.1.", "8.2.", "8.3.", "COURSE ASSESSMENT", "9.1.", "9.2.", "9.3.",
  "9.4.", "9.5.", "9.6.", "INTEGRITY POLICY", "CLASSROOM ETIQUETTE",
];

const GRADE_EQUIVALENCE =
  "SUAD uses the French grading system, in which grades are awarded on a scale from 0 to 20, with 0 representing the lowest achievable mark.";

const SUBSECTION = {
  methods: "8.1 Teaching methods and learning activities",
  engagement: "8.2 Student engagement",
  feedback: "8.3 Feedback and academic progress",
} as const;

/** A numbered section of the template: red capitals on a grey band, as the document heads it. */
function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  const [number, ...words] = /^\d+\.\s/.test(heading) ? heading.split(/\s+/) : ["", ...heading.split(/\s+/)];
  return (
    <section className="mt-8">
      <h3 className="flex gap-6 px-1 py-0.5 text-[13px] font-bold" style={{ color: DOC.red, background: DOC.band }}>
        {number ? <span>{number}</span> : null}
        <span>{words.join(" ")}</span>
      </h3>
      {children}
    </section>
  );
}

/** A sub-heading inside a section — "2.1. Course instructor" — in the template's navy. */
function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mt-5 text-[13px] font-bold" style={{ color: DOC.navy }}>{children}</h4>;
}

const cell = { border: `1px solid ${DOC.red}`, padding: "6px 8px", verticalAlign: "top" } as const;
const labelCell = { ...cell, background: DOC.label, color: "#FFFFFF", fontWeight: 700, width: "45%" } as const;

/** Label and value, row after row: the template's identification and contact tables. Empty rows print too. */
function LabelTable({ rows: entries, title }: { rows: Array<[string, React.ReactNode]>; title?: string }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse" style={{ border: `1px solid ${DOC.red}` }}>
        <tbody>
          {title ? <tr><th colSpan={2} className="text-left" style={{ ...labelCell, width: "auto" }}>{title}</th></tr> : null}
          {entries.map(([label, value], index) => (
            <tr key={`${label}-${index}`}>
              <th scope="row" className="text-left" style={title ? { ...labelCell, width: "18%" } : labelCell}>{label}</th>
              <td className="whitespace-pre-line" style={cell}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A table with a heading row: the outcomes, the schedule, the assessments and the rubrics. */
function GridTable({ headers, body, boldFirstColumn = false }: { headers: string[]; body: string[][]; boldFirstColumn?: boolean }) {
  const filled = body.filter((row) => row.some(Boolean));
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse" style={{ border: `1px solid ${DOC.red}` }}>
        <thead>
          <tr>{headers.map((header) => <th key={header} className="text-center" style={{ ...labelCell, width: "auto", verticalAlign: "middle" }}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {(filled.length ? filled : [headers.map(() => "")]).map((row, index) => (
            <tr key={index}>
              {row.map((value, position) => (
                <td key={position} className={`whitespace-pre-line ${boldFirstColumn && position === 0 ? "text-center font-bold" : ""}`} style={cell}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Running text in the template's red-ruled box. */
function Box({ value }: { value: string }) {
  return <div className="mt-3 min-h-16 whitespace-pre-line" style={{ ...cell, padding: "8px 10px" }}>{value}</div>;
}

/** The six contact-hour rows the template lists inside one cell, each with its hours. */
function ContactHours({ hours }: { hours: Record<string, string> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1">
      {CONTACT_HOUR_ROWS.map((row) => (
        <div key={row} className="contents">
          <dt>{row === "Other" ? "Other (e.g. field trips, professional certification activities, student project supervision)" : row}</dt>
          <dd className="text-right tabular-nums">{hours[row] ?? ""}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The template's delivery table: face-to-face ticked, or the blended split. */
function DeliveryTable({ mode, faceToFace, online }: { mode: string; faceToFace: string; online: string }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse" style={{ border: `1px solid ${DOC.red}` }}>
        <thead>
          <tr>
            <th rowSpan={2} className="text-left" style={{ ...labelCell, width: "50%", verticalAlign: "middle" }}>Face-to-Face Delivery</th>
            <th colSpan={2} className="text-center" style={{ ...labelCell, width: "auto" }}>Blended Learning Delivery</th>
          </tr>
          <tr>
            <th className="text-center" style={{ ...cell, background: DOC.band, fontWeight: 700 }}>Face-to-Face (%)</th>
            <th className="text-center" style={{ ...cell, background: DOC.band, fontWeight: 700 }}>Online (%)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>{mode === "Face-to-Face Delivery" ? "☒" : ""}</td>
            <td style={cell}>{faceToFace}</td>
            <td style={cell}>{online}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** "100" as the document writes it: "100%". */
function percentage(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return "";
  return raw.endsWith("%") ? raw : `${raw}%`;
}

function listText(items: unknown, legacy: unknown) {
  if (Array.isArray(items)) return items.map((item) => text(record(item).text)).filter(Boolean).join("\n");
  return text(legacy);
}

function resources(value: unknown) {
  return rows(value).map((item) => [text(item.title), text(item.authors), text(item.freeformText), text(item.legacyText)].filter(Boolean).join(" · ")).filter(Boolean).join("\n");
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

/** What the document writes beside a ticked AI option: the details that option asks for. */
function aiOptionDetails(option: string, assessment: Record<string, unknown>, activities: Array<Record<string, unknown>>, fallback: string): string {
  if (option === "AI Prohibited") {
    const mechanism = text(assessment.aiVerificationMechanism);
    return mechanism ? `Verification mechanism used by the instructor: ${mechanism}` : "";
  }
  if (option === "AI Permitted as a Support Tool") {
    const uses = Array.isArray(assessment.aiAllowedUses) ? assessment.aiAllowedUses.filter((use): use is string => typeof use === "string").map(templatePermittedUse) : [];
    const other = Array.isArray(assessment.aiOtherUses)
      ? assessment.aiOtherUses.map((item) => text(record(item).text)).filter(Boolean)
      : [text(assessment.aiOtherUse)].filter(Boolean);
    return [...uses, ...other.map((use) => `Other: ${use}`)].join("\n");
  }
  if (option === OTHER_AI_OPTION) {
    return activities
      .filter((activity) => aiOption(activityAiPolicy(activity, fallback).label) === OTHER_AI_OPTION && text(activity.aiOtherText))
      .map((activity) => `${text(activity.name) || text(activity.type) || "Activity"}: ${text(activity.aiOtherText)}`)
      .join("\n");
  }
  return "";
}
