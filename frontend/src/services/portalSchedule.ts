/**
 * Whether a teacher's portal schedule agrees with our planning.
 *
 * A teacher's schedule on the portal is drawn from the registrar's timetable, which staffs
 * each section with a name of its own — and that name is changed by the registrar, not by
 * us. Ahmed Menaa was put on Maths Readiness G.3 and G.6 in our planning; his week here
 * showed them, and his week on the portal did not, because the registrar's timetable still
 * had Sachin Valera on both. Nothing said so until somebody looked at the portal.
 *
 * Three things are said, each once per teacher:
 *
 * - **not on the portal**: a section our planning gives them, which the timetable staffs
 *   with somebody else (or nobody) — the registrar has to put them on it;
 * - **on the portal, not ours**: a section the timetable staffs with them, which our
 *   planning gives to somebody else — the registrar has to take them off it. The same
 *   mismatch seen from the other teacher's row, so both sides of a hand-over say so;
 * - **not timetabled yet**: a section of theirs the registrar has no timetable for at all.
 *   Not a wrong name, and nothing the teacher did, but it is why their week there is short.
 *
 * Each is one warning with a key made of the sections it is about and what the portal
 * says of each, so a dismissal holds until either changes — the way every dismissal does.
 */

import { rowsPerPart, type Card } from "@/services/courseCards";
import { filled } from "@/services/courseRequest";
import type { FacilityHours } from "@/services/portalLists";
import { sameTeacher, sectionsTaughtBy } from "@/services/teacherLoad";
import type { Dismissal } from "@/services/warningDismissals";

export type ScheduleKind = "not_on_portal" | "portal_only" | "not_timetabled";

export type ScheduleLine = {
  termCode: string;
  crn: string;
  /** "SCEN-102 RDNS 3". */
  where: string;
  /** Who the other side names: the portal's teacher, or — for portal_only — ours. */
  other: string;
};

export type ScheduleWarning = {
  key: string;
  kind: ScheduleKind;
  /** The pill's few words: "2 not on portal". */
  label: string;
  /** The whole sentence, on the pill's title and in the bring-back list. */
  sentence: string;
  lines: ScheduleLine[];
  dismissed: boolean;
  dismissedBy: string;
  dismissedAt: string;
};

/** What the filter calls each kind. */
export const KIND_WORDS: Record<ScheduleKind, string> = {
  not_on_portal: "Not on portal",
  portal_only: "On portal, not ours",
  not_timetabled: "Not timetabled",
};

/** A section's teacher field that names nobody. */
const NOBODY = /^(tbd|tba|tbc|n\/?a|-|—|\?|staff)?$/i;

/** The people a portal teacher field names — "Diaa Mereib, Sara Khaled" is two. */
function people(field: string): string[] {
  return (field || "").split(/\s*(?:,|;|\/|&|\band\b)\s*/).filter((part) => part.trim());
}

function names(field: string, teacher: string): boolean {
  return people(field).some((person) => sameTeacher(person, teacher));
}

/**
 * Who our planning gives each section to: `"<portal term>|<crn>"` → their names.
 *
 * Read the way the cards read a section: per part, the chosen teacher's name where there
 * is one, the typed name otherwise, and nobody for a blank or a "TBD".
 */
export function plannedTeachers(
  cards: Card[],
  links: Record<string, string>,
  nameOf: (teacherId: string) => string,
): Map<string, string[]> {
  const held = new Map<string, string[]>();
  for (const card of cards) {
    const termCode = links[card.termId] ?? "";
    if (!termCode) continue;
    for (const set of card.sets) {
      for (const row of set.rows.flatMap((entry) => rowsPerPart(entry))) {
        if (!row.section || !row.section.crn || row.section.retired) continue;
        const section = filled(row.section, set.course.request);
        const name = section.teacherId ? nameOf(section.teacherId) : section.teacher.trim();
        if (!name || NOBODY.test(name)) continue;
        const key = `${termCode}|${section.crn}`;
        const known = held.get(key) ?? [];
        if (!known.some((other) => sameTeacher(other, name))) known.push(name);
        held.set(key, known);
      }
    }
  }
  return held;
}

/**
 * One teacher's disagreements with the portal.
 *
 * `registrar` holds only the terms whose timetable has been read: a term missing from it
 * says nothing, rather than calling every section of it untimetabled.
 */
export function portalScheduleWarnings(input: {
  teacher: { id: string; fullName: string };
  cards: Card[];
  links: Record<string, string>;
  registrar: Record<string, FacilityHours>;
  planned: Map<string, string[]>;
  decided: Map<string, Dismissal>;
}): ScheduleWarning[] {
  const { teacher, cards, links, registrar, planned, decided } = input;
  if (!teacher.fullName.trim()) return [];
  const found: Record<ScheduleKind, ScheduleLine[]> = { not_on_portal: [], portal_only: [], not_timetabled: [] };
  const mine = new Set<string>();

  for (const section of sectionsTaughtBy(cards, teacher.id, teacher.fullName)) {
    const termCode = links[section.termId] ?? "";
    if (section.retired || !section.crn || !termCode || !registrar[termCode]) continue;
    const key = `${termCode}|${section.crn}`;
    if (mine.has(key)) continue;
    mine.add(key);
    const where = `${section.courseCode} ${section.scopeCode} ${section.groupLabel}`.trim();
    const booked = registrar[termCode][section.crn];
    if (!booked || !booked.hours) {
      found.not_timetabled.push({ termCode, crn: section.crn, where, other: "" });
    } else if (!names(booked.teacherName, teacher.fullName)) {
      found.not_on_portal.push({ termCode, crn: section.crn, where, other: booked.teacherName.trim() || "nobody" });
    }
  }

  for (const [termCode, sections] of Object.entries(registrar)) {
    for (const [crn, booked] of Object.entries(sections)) {
      const key = `${termCode}|${crn}`;
      if (mine.has(key) || !booked.hours || !names(booked.teacherName, teacher.fullName)) continue;
      // Only a section our planning has decided: one nobody in it is named on, or that is
      // another department's, is the portal's to staff.
      const ours = planned.get(key);
      if (!ours?.length || ours.some((name) => sameTeacher(name, teacher.fullName))) continue;
      found.portal_only.push({ termCode, crn, where: whereOf(cards, links, termCode, crn) || `${booked.courseCode} ${crn}`, other: ours.join(", ") });
    }
  }

  return (Object.keys(found) as ScheduleKind[])
    .filter((kind) => found[kind].length)
    .map((kind) => {
      const lines = found[kind].sort((left, right) => left.where.localeCompare(right.where, undefined, { numeric: true }));
      const key = `portal-schedule:${kind}:${teacher.id}:${lines.map((line) => `${line.termCode}:${line.crn}:${line.other}`).join(",")}`;
      const answered = decided.get(key);
      return {
        key,
        kind,
        label: labelOf(kind, lines.length),
        sentence: sentenceOf(kind, lines),
        lines,
        dismissed: Boolean(answered),
        dismissedBy: answered ? answered.byName || answered.byEmail : "",
        dismissedAt: answered?.at ?? "",
      };
    });
}

/** "SCEN-102 RDNS 3" for a CRN our planning holds, whoever it is given to. */
function whereOf(cards: Card[], links: Record<string, string>, termCode: string, crn: string): string {
  for (const card of cards) {
    if ((links[card.termId] ?? "") !== termCode) continue;
    for (const set of card.sets) {
      for (const row of set.rows.flatMap((entry) => rowsPerPart(entry))) {
        if (row.section?.crn === crn) return `${card.code} ${set.scope.code} ${row.group.label}`;
      }
    }
  }
  return "";
}

function labelOf(kind: ScheduleKind, count: number): string {
  if (kind === "not_on_portal") return `${count} not on portal`;
  if (kind === "portal_only") return `${count} on portal, not ours`;
  return `${count} not timetabled`;
}

function sentenceOf(kind: ScheduleKind, lines: ScheduleLine[]): string {
  const many = lines.length !== 1;
  const list = (say: (line: ScheduleLine) => string) => lines.map(say).join("; ");
  if (kind === "not_on_portal") {
    return `${lines.length} section${many ? "s" : ""} our planning gives them ${many ? "are" : "is"} not on their portal schedule — the registrar's timetable has ${list((line) => `${line.where} (${line.crn}): ${line.other}`)}.`;
  }
  if (kind === "portal_only") {
    return `Their portal schedule has ${lines.length} section${many ? "s" : ""} our planning gives to somebody else — ${list((line) => `${line.where} (${line.crn}): ours is ${line.other}`)}.`;
  }
  return `${lines.length} section${many ? "s" : ""} of theirs ${many ? "have" : "has"} no timetable from the registrar yet, so ${many ? "they are" : "it is"} not on their portal schedule: ${list((line) => `${line.where} (${line.crn})`)}.`;
}
