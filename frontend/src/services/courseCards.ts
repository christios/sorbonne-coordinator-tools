/**
 * The Groups & CRNs page as cards: one per course, its sections inside.
 *
 * The server keeps blocks — a group set with courses across and groups down — because
 * that is how students are placed. The timetabler's workbook, and the coordinator's
 * eye, go course by course: Pre-calculus 1, and under it every section anybody teaches
 * of it, whichever group set it belongs to. This turns the one into the other, purely,
 * so the page can be filtered and searched the way the tables are.
 */

import type { ActiveCourse } from "@/services/portalLists";
import { partsOf, sectionFor, shortProgram } from "@/services/studentDatabase";
import type { CatalogueCourse, CatalogueGroup, CatalogueMajor, CatalogueScope, CohortCatalogue, SectionPart } from "@/services/studentDatabase";
import type { GridColumn } from "@/services/studentColumns";

export type SectionRow = {
  scope: CatalogueScope;
  group: CatalogueGroup;
  course: CatalogueCourse;
  /** Null when this group holds nothing for the course yet — a row that can be started. */
  /**
   * The section this group holds for this course, or one part of it.
   *
   * `buildCards` puts the whole section here, first part at the top level and `parts`
   * beside it. `rowsPerPart` hands back a row per part, and those carry a part — which is
   * a section minus its list of siblings, so everything that reads a CRN, a teacher or a
   * request field is right either way. Use `partsOf` rather than `.parts` to be sure.
   */
  section: SectionPart | null;
  /**
   * How many parts the section this row came from has — 1 unless `rowsPerPart` split it.
   *
   * Carried on the row because a part does not know how many siblings it has, and a card
   * headed "part 2" with no "of 2" beside it is a card that raises a question rather than
   * answering one.
   */
  parts?: number;
  /**
   * How many of the group's students do not take this course.
   *
   * On the row rather than read off `section`, because a row may carry a single part and a
   * part has no count of its own: an exemption is from the COURSE, so both halves of a
   * handover teach the same people and are short the same ones.
   */
  exempt?: number;
  /** What this section's CRN hangs from, as the register says. Empty when unregistered. */
  parentCrn: string;
  /**
   * The sub-row this row is, for a group that has them. `group` then carries the sub-row's
   * label ("1 · Mathematics"), seats and count, and its id stays the group's — a placement
   * is into the group, on this sub-row.
   */
  major: CatalogueMajor | null;
  /** A sub-row's word that it is not taught this course: no class, no CRN wanted. */
  notTaught: boolean;
  /**
   * True when the section is the group's shared cell, seen from a sub-row. It is one cell
   * and one class however many sub-rows show it; `firstSubRow` marks the one row that
   * counts it, so hours and the request to the timetabler are not doubled.
   */
  sharedCell: boolean;
  firstSubRow: boolean;
};

export type CardSet = {
  scope: CatalogueScope;
  /** The course row of this set the card is about. */
  course: CatalogueCourse;
  rows: SectionRow[];
};

export type Card = {
  /** Cohort, semester and course code together: one card per course per semester. */
  key: string;
  cohortId: string;
  cohortName: string;
  termId: string;
  termName: string;
  code: string;
  name: string;
  /** The active course this card is, when the code is on the department's list. */
  active: ActiveCourse | null;
  /** Its UE, read from the active course — empty when the code is not on the list. */
  ue: string;
  sets: CardSet[];
};

/**
 * Cards from every cohort's catalogue.
 *
 * A course appears once per cohort and semester, however many group sets carry it: the
 * CM set's MATH001 and the TD set's MATH001 are one card with two sets inside. The title,
 * UE and parent CRN are the active course's, since that is the one place they are kept;
 * a card whose code is not on that list keeps the title typed on its rows and has no UE.
 */
export function buildCards(
  cohorts: CohortCatalogue[],
  termName: (termId: string) => string,
  activeCourses: ActiveCourse[] = [],
  /** CRN -> the parent CRN the register holds for it. */
  parentOf: Map<string, string> = new Map(),
): Card[] {
  const active = new Map(activeCourses.map((course) => [course.courseCode.toUpperCase(), course]));
  const cards = new Map<string, Card>();
  for (const held of cohorts) {
    for (const scope of held.scopes) {
      const termId = scope.termId ?? "";
      for (const course of scope.courses) {
        const code = course.code.toUpperCase();
        const key = `${held.cohort.id}|${termId}|${code}`;
        let card = cards.get(key);
        if (!card) {
          const known = active.get(code) ?? null;
          card = {
            key,
            cohortId: held.cohort.id,
            cohortName: held.cohort.name,
            termId,
            termName: termName(termId),
            code: course.code,
            name: known?.title || course.name,
            active: known,
            ue: known?.ue ?? "",
            sets: [],
          };
          cards.set(key, card);
        }
        card.name ||= course.name;
        card.sets.push({
          scope,
          course,
          rows: scope.groups.flatMap((group) => subRows(scope, group, course, parentOf)),
        });
      }
    }
  }
  return [...cards.values()].sort(
    (left, right) =>
      left.cohortName.localeCompare(right.cohortName) ||
      left.termName.localeCompare(right.termName) ||
      left.code.localeCompare(right.code, undefined, { numeric: true }),
  );
}

/**
 * Whether this group is one of the ones this course is taught to.
 *
 * The matrix's own assumption is that every group of a set teaches every course of it, and
 * in a set split by group number that is exactly right: Foundation Year's TD 1, 2 and 3 all
 * take everything the set carries, so a blank cell there is a section nobody has a CRN for.
 *
 * A set split by PROGRAMME is the other case. L3's CM set carries four Maths courses and
 * six Physics ones and holds a group called "Mathematics" and one called "Physics"; the
 * matrix duly asked the Physics group for a CRN in MATH-330. Counted on production the day
 * this was written: 25 such cells in L2 and 20 in L3, and every one of the 45 sections
 * those pages called "without a CRN" was one of them. Not one was real.
 *
 * Blank on either side means everyone, so a set that says nothing behaves as it always did.
 * The vocabulary is the registrar's — `scope_groups.program` is matched against a student's
 * MAJOR_CODE_DESC by the fill, and this is the other half of the same idea.
 */
export function teaches(row: Pick<SectionRow, "notTaught">): boolean {
  /*
   * Whether this row is a class at all. A group with no sub-rows teaches every course of
   * its set. A sub-row is taught every course too, unless a cell of its own says it is not.
   */
  return !row.notTaught;
}

/**
 * The rows one group contributes for one course: one, or one per sub-row.
 *
 * A group with sub-rows is read through them. Each sub-row's row carries what that sub-row
 * is taught — its own cell, or the shared one — and a sub-row not taught the course still
 * gets a row, with no section, so the card can say so rather than leave a gap that reads
 * as "no CRN yet".
 */
function subRows(
  scope: CatalogueScope,
  group: CatalogueGroup,
  course: CatalogueCourse,
  parentOf: Map<string, string>,
): SectionRow[] {
  const majors = group.majors ?? [];
  if (majors.length === 0) {
    const section = group.crns[course.id] ?? null;
    return [
      {
        scope,
        group,
        course,
        section,
        exempt: section?.exempt ?? 0,
        parentCrn: (section?.crn && parentOf.get(section.crn)) || "",
        major: null,
        notTaught: false,
        sharedCell: false,
        firstSubRow: true,
      },
    ];
  }
  const rows = majors.map((major, index) => {
    const own = group.byMajor?.[major.id]?.[course.id];
    const section = sectionFor(group, major.id, course.id);
    return {
      scope,
      group: subRowGroup(group, major),
      course,
      section,
      exempt: section?.exempt ?? 0,
      parentCrn: (section?.crn && parentOf.get(section.crn)) || "",
      major,
      notTaught: Boolean(own?.notTaught),
      sharedCell: Boolean(section) && !own,
      firstSubRow: index === 0,
    };
  });
  /*
   * A lecture every taught sub-row shares is one class, and one row: L1's CM is one group
   * of mathematicians and physicists, and MATH-100's lecture is theirs together. Shown once
   * per major it was the same CRN twice on the card — the thing the merge was for. A
   * sub-row not taught the course keeps its row, which is where that is said.
   */
  const taught = rows.filter((row) => !row.notTaught);
  const shared = taught.length >= 2 && taught.every((row) => !group.byMajor?.[row.major.id]?.[course.id]);
  if (!shared) return rows;
  const section = group.crns[course.id] ?? null;
  return [
    {
      scope,
      group,
      course,
      section,
      exempt: section?.exempt ?? 0,
      parentCrn: (section?.crn && parentOf.get(section.crn)) || "",
      major: null,
      notTaught: false,
      sharedCell: false,
      firstSubRow: true,
    },
    ...rows.filter((row) => row.notTaught).map((row) => ({ ...row, firstSubRow: false })),
  ];
}

type SeatedRow = Pick<SectionRow, "group" | "course" | "major" | "notTaught">;

/**
 * The sub-rows that sit in this row's class. Empty for a group with none, and for a
 * sub-row not taught the course.
 *
 * A sub-row with a cell of its own is a class of its own. The cell the sub-rows share is
 * one class for every sub-row without a cell of its own — and a sub-row's word that it is
 * not taught is a cell of its own, so it is in no shared class either.
 */
export function classSubRows(row: SeatedRow): CatalogueMajor[] {
  const majors = row.group.majors ?? [];
  if (!majors.length || row.notTaught) return [];
  const own = (major: CatalogueMajor) => Boolean(row.group.byMajor?.[major.id]?.[row.course.id]);
  if (row.major && own(row.major)) return [row.major];
  return majors.filter((major) => !own(major));
}

/**
 * Whose seats a card stands for, and so what editing its seats changes: its own sub-row,
 * or on the one card a shared class is drawn as, every sub-row in that class. Empty means
 * the group itself.
 */
export function cardSubRows(row: SeatedRow): CatalogueMajor[] {
  if (row.notTaught) return [];
  return row.major ? [row.major] : classSubRows(row);
}

const added = (majors: CatalogueMajor[], count: (major: CatalogueMajor) => number) =>
  majors.reduce((sum, major) => sum + (count(major) || 0), 0);

/** The seats a card shows, and how many sit on them. */
export function cardSeats(row: SeatedRow): { seats: number; placed: number } {
  const subRows = cardSubRows(row);
  if (!subRows.length) return row.notTaught ? { seats: 0, placed: 0 } : { seats: row.group.capacity, placed: row.group.assigned };
  return { seats: added(subRows, (major) => major.seats), placed: added(subRows, (major) => major.assigned) };
}

/**
 * How many students the timetabler is told to expect: the seats of the class.
 *
 * Not a number of its own any more. It was typed on each section, beside seats typed on
 * Group schema, and the two drifted — a card read "20 seats, 24 expected" and nobody
 * could say which was meant. The class is as big as its seats: a group's own, one
 * sub-row's, or every sub-row that shares the cell added up.
 */
export function anticipatedOf(row: SeatedRow): number {
  const subRows = classSubRows(row);
  if (row.notTaught) return 0;
  return subRows.length ? added(subRows, (major) => major.seats) : row.group.majors?.length ? 0 : row.group.capacity;
}

/** The group as one sub-row sees it: the sub-row's label, seats and count, the group's id. */
export function subRowGroup(group: CatalogueGroup, major: CatalogueMajor): CatalogueGroup {
  return {
    ...group,
    label: subRowLabel(group.label, major.program, (group.majors ?? []).length),
    capacity: major.seats,
    assigned: major.assigned,
  };
}

/**
 * "1 · Mathematics" for a sub-row of a group that has another; "Mathematics" for the one
 * sub-row of a group that holds mathematicians alone — the label already says it, and
 * "Mathematics · Mathematics" would say it twice.
 */
export function subRowLabel(groupLabel: string, program: string, subRows: number): string {
  const name = shortProgram(program);
  if (subRows < 2 || !name || groupLabel.trim().toLowerCase() === name.toLowerCase()) return groupLabel;
  return `${groupLabel} · ${name}`;
}

/** The key a row is one of, on a page: the group, and the sub-row when it is one. */
export function rowKey(row: Pick<SectionRow, "group" | "major">): string {
  return row.major ? `${row.group.id}|${row.major.id}` : row.group.id;
}

export function sectionsOf(card: Card): SectionRow[] {
  return card.sets.flatMap((set) => set.rows);
}

/**
 * One row per stretch of teaching, rather than one per (group, course).
 *
 * A card row is a section, and a section handed from one professor to another at
 * mid-semester is taught in two parts under a CRN each. Anything that is really about the
 * teaching — the request the timetabler is sent, whose hours these are — wants a row for
 * each; anything about the group — its seats, its fill, who is in it — wants the section
 * whole, and keeps using `rows`.
 *
 * A section with one part yields itself, so this is a no-op for almost every card.
 */
export function rowsPerPart(row: SectionRow): SectionRow[] {
  const parts = partsOf(row.section);
  if (parts.length < 2) return [row];
  return parts.map((part) => ({ ...row, section: part, parts: parts.length }));
}

/** The teachers a card's sections name, for the filter and the collapsed line. */
export function teachersOf(card: Card, nameOf: (teacherId: string) => string): string[] {
  const names = new Set<string>();
  for (const row of sectionsOf(card)) {
    const name = row.section?.teacherId ? nameOf(row.section.teacherId) : row.section?.teacher ?? "";
    if (name) names.add(name);
  }
  return [...names].sort();
}

/** What the filter bar and the search box may ask of a card. */
export function cardColumns(nameOf: (teacherId: string) => string): GridColumn<Card>[] {
  return [
    { id: "termName", displayName: "Semester", type: "option", accessor: (card) => card.termName, defaultWidth: 160 },
    { id: "cohortName", displayName: "Cohort", type: "option", accessor: (card) => card.cohortName, defaultWidth: 160 },
    { id: "code", displayName: "Course", type: "text", accessor: (card) => card.code, defaultWidth: 120 },
    { id: "name", displayName: "Title", type: "text", accessor: (card) => card.name, defaultWidth: 200 },
    {
      id: "active",
      displayName: "On the active list",
      type: "option",
      accessor: (card) => (card.active ? "Active" : "Not active"),
      defaultWidth: 120,
    },
    { id: "sets", displayName: "Group set", type: "multiOption", accessor: (card) => card.sets.map((set) => set.scope.code), defaultWidth: 120 },
    { id: "types", displayName: "Type", type: "multiOption", accessor: (card) => [...new Set(card.sets.map((set) => set.course.component).filter(Boolean))], defaultWidth: 100 },
    { id: "teachers", displayName: "Teacher", type: "multiOption", accessor: (card) => teachersOf(card, nameOf), defaultWidth: 200 },
    { id: "crns", displayName: "CRN", type: "multiOption", accessor: (card) => sectionsOf(card).map((row) => row.section?.crn ?? "").filter(Boolean), defaultWidth: 120 },
    {
      id: "retired",
      displayName: "Retired sections",
      type: "option",
      accessor: (card) => (sectionsOf(card).some((row) => row.section?.retired) ? "Has retired" : "None"),
      defaultWidth: 120,
    },
    {
      id: "missing",
      displayName: "CRN missing",
      type: "option",
      accessor: (card) => (sectionsOf(card).some((row) => !row.section?.crn && !row.section?.retired) ? "Some missing" : "All set"),
      defaultWidth: 120,
    },
  ];
}

/**
 * The group of ours each CRN teaches — "CM Mathematics", "TD 3" — walked off the cards,
 * since nothing indexes the matrix by CRN. The first card naming a CRN wins.
 */
export function groupNamesByCrn(cohorts: CohortCatalogue[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const card of buildCards(cohorts, () => "", [])) {
    for (const set of card.sets) {
      for (const row of set.rows.filter((entry) => teaches(entry)).flatMap((entry) => rowsPerPart(entry))) {
        const crn = row.section?.crn;
        if (!crn || names.has(crn)) continue;
        names.set(crn, `${set.scope.code} ${subRowLabel(row.group.label, row.major?.program ?? "", (row.group.majors ?? []).length)}`.trim());
      }
    }
  }
  return names;
}
