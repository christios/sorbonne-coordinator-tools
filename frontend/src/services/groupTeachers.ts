/**
 * Who teaches a group, as a person would say it.
 *
 * A group is not taught by one person. Its set carries a course, or three, and each has
 * its own section with its own name on it — so "TD 1" is Dr Maaz for the tutorial and Dr
 * Kaur for the practical, and a screen that offers to put a student in TD 1 without saying
 * either is asking for a decision while withholding what the decision is about.
 *
 * Names are resolved the way the rest of the application resolves them: the department's
 * own record where a section has chosen one, and the free text the registrar wrote where
 * nobody has. Distinct and in the order the set's courses are read in, so a group taught
 * throughout by one person says that person once.
 */

import { type CatalogueGroup, type CatalogueScope, partsOf, sectionFor } from "@/services/studentDatabase";

export function teachersOfGroup(
  scope: CatalogueScope,
  group: CatalogueGroup,
  /** The sub-row the student sits on, when the group has them — its sections can differ. */
  majorId: string,
  /** The department's name for a chosen teacher, by id. */
  nameOf: (teacherId: string) => string = () => "",
): string[] {
  const names: string[] = [];
  for (const course of scope.courses) {
    for (const part of partsOf(sectionFor(group, majorId, course.id))) {
      // A section handed over at mid-semester is two names, and both of them teach it.
      const name = (part.teacherId && nameOf(part.teacherId)) || part.teacher;
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** "Dr Maaz, Dr Kaur", or a plain word when the group has nobody down for it yet. */
export function teachersSaid(names: string[]): string {
  return names.length ? names.join(", ") : "no teacher yet";
}
