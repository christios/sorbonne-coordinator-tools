/**
 * The Groups & CRNs page as cards: one per course, its sections inside.
 *
 * The server keeps blocks — a group set with courses across and groups down — because
 * that is how students are placed. The timetabler's workbook, and the coordinator's
 * eye, go course by course: Pre-calculus 1, and under it every section anybody teaches
 * of it, whichever group set it belongs to. This turns the one into the other, purely,
 * so the page can be filtered and searched the way the tables are.
 */

import type { CatalogueCourse, CatalogueGroup, CatalogueScope, CohortCatalogue, Section } from "@/services/studentDatabase";
import type { GridColumn } from "@/services/studentColumns";

export type SectionRow = {
  scope: CatalogueScope;
  group: CatalogueGroup;
  course: CatalogueCourse;
  /** Null when this group holds nothing for the course yet — a row that can be started. */
  section: Section | null;
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
  ue: string;
  parentCrn: string;
  sets: CardSet[];
};

/**
 * Cards from every cohort's catalogue.
 *
 * A course appears once per cohort and semester, however many group sets carry it: the
 * CM set's MATH001 and the TD set's MATH001 are one card with two sets inside. The name,
 * UE and parent CRN are the first non-empty ones found, since the rows were typed apart.
 */
export function buildCards(cohorts: CohortCatalogue[], termName: (termId: string) => string): Card[] {
  const cards = new Map<string, Card>();
  for (const held of cohorts) {
    for (const scope of held.scopes) {
      const termId = scope.termId ?? "";
      for (const course of scope.courses) {
        const key = `${held.cohort.id}|${termId}|${course.code.toUpperCase()}`;
        let card = cards.get(key);
        if (!card) {
          card = {
            key,
            cohortId: held.cohort.id,
            cohortName: held.cohort.name,
            termId,
            termName: termName(termId),
            code: course.code,
            name: course.name,
            ue: course.ue,
            parentCrn: course.parentCrn,
            sets: [],
          };
          cards.set(key, card);
        }
        card.name ||= course.name;
        card.ue ||= course.ue;
        card.parentCrn ||= course.parentCrn;
        card.sets.push({
          scope,
          course,
          rows: scope.groups.map((group) => ({ scope, group, course, section: group.crns[course.id] ?? null })),
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

export function sectionsOf(card: Card): SectionRow[] {
  return card.sets.flatMap((set) => set.rows);
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
    { id: "ue", displayName: "UE", type: "option", accessor: (card) => card.ue, defaultWidth: 120 },
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
