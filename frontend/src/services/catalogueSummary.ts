import type { CatalogueScope } from "@/services/studentDatabase";

export type CatalogueCounts = {
  blocks: number;
  groups: number;
  courses: number;
  /** Group-and-course pairs that hold a CRN, out of every pair there is. */
  filled: number;
  cells: number;
};

/**
 * What the catalogue holds, in the numbers worth saying out loud.
 *
 * The one that earns its place is the last pair. A block looks finished as soon as its
 * groups and courses are there, but a group with an empty cell teaches nothing in that
 * course — and an empty cell is invisible in a wide matrix you have to scroll. Counting
 * them says how much is left before this semester can be published.
 */
export function summariseCatalogue(scopes: CatalogueScope[]): CatalogueCounts {
  let groups = 0;
  let courses = 0;
  let filled = 0;
  let cells = 0;

  for (const scope of scopes) {
    groups += scope.groups.length;
    courses += scope.courses.length;
    cells += scope.groups.length * scope.courses.length;
    for (const group of scope.groups) {
      for (const course of scope.courses) {
        if (group.crns[course.id]?.crn.trim()) filled += 1;
      }
    }
  }

  return { blocks: scopes.length, groups, courses, filled, cells };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The counts as one line: "3 blocks · 12 groups · 9 courses · 34 of 36 CRNs filled". */
export function countsLine(counts: CatalogueCounts): string {
  const parts = [
    plural(counts.blocks, "block"),
    plural(counts.groups, "group"),
    plural(counts.courses, "course"),
  ];
  if (counts.cells) {
    parts.push(
      counts.filled === counts.cells
        ? `every CRN filled`
        : `${counts.filled} of ${counts.cells} CRNs filled`,
    );
  }
  return parts.join(" · ");
}
