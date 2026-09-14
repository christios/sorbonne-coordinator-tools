/**
 * The two lists a coordinator is actually comparing, and where they part company.
 *
 * One is what the groups a student has been placed in add up to — every CRN those groups
 * stand for. The other is what the registrar has them registered in. Everything worth
 * knowing about a student's registration is the difference between the two, and until now
 * it had to be assembled by eye from a list of groups on one side of the page and a list
 * of courses on the other, with the warnings folded in among the courses.
 *
 * Pure, and about CRNs rather than courses. A course is where the two lists disagree most
 * confusingly — the same course can be a lecture we expect and a tutorial we do not — and
 * a CRN is the thing both sides actually name.
 */

export type Placement = {
  scope: { id: string; code: string };
  group?: { label: string };
  /** `courseName` is what our own set calls the course; the label when the registrar has no row. */
  crns: { courseCode: string; crn: string; courseName?: string }[];
};

export type Registration = { crn: string; courseCode: string; title: string; status: string };

/** One CRN, and whether each side has it. */
export type Line = {
  crn: string;
  courseCode: string;
  /**
   * The registrar's name for the section when the registrar has this student in it;
   * otherwise our own name for the course, so a row that says "not registered" still
   * says what it is.
   */
  title: string;
  /** "CM 1" — the group of ours that stands for this CRN, when one does. */
  from: string;
  ours: boolean;
  portal: boolean;
};

/** Every CRN the student's groups give them, in reading order. */
export function fromGroups(placements: Placement[]): Line[] {
  const lines: Line[] = [];
  for (const placement of placements) {
    for (const cell of placement.crns) {
      if (!cell.crn) continue;
      lines.push({
        crn: cell.crn,
        courseCode: cell.courseCode,
        title: cell.courseName ?? "",
        from: `${placement.scope.code} ${placement.group?.label ?? "?"}`.trim(),
        ours: true,
        portal: false,
      });
    }
  }
  return sorted(lines);
}

/** Every CRN the registrar has them in, in reading order. Withdrawn rows are not registrations. */
export function fromPortal(registrations: Registration[]): Line[] {
  return sorted(
    registrations
      .filter((registration) => registration.status === "in_portal")
      .map((registration) => ({
        crn: registration.crn,
        courseCode: registration.courseCode || "—",
        title: registration.title,
        from: "",
        ours: false,
        portal: true,
      })),
  );
}

/**
 * The two lists as one, so the difference is a column rather than a comparison.
 *
 * A CRN either side has is a line; a CRN both have is one line saying so. What is left —
 * ours and not theirs, theirs and not ours — is exactly the work.
 */
export function reconcile(placements: Placement[], registrations: Registration[]): Line[] {
  const held = new Map<string, Line>();
  for (const line of fromGroups(placements)) held.set(line.crn, { ...line });
  for (const line of fromPortal(registrations)) {
    const already = held.get(line.crn);
    if (already) {
      already.portal = true;
      // The registrar's name for the section wins; ours stands only where theirs is blank.
      already.title = line.title || already.title;
      // The registrar's course code where ours is silent; ours is the one that decided.
      already.courseCode = already.courseCode || line.courseCode;
    } else {
      held.set(line.crn, line);
    }
  }
  return sorted([...held.values()]);
}

/** What the two lists come to: how many agree, and how many are on one side only. */
export function tally(lines: Line[]): { agree: number; onlyOurs: number; onlyPortal: number } {
  return {
    agree: lines.filter((line) => line.ours && line.portal).length,
    onlyOurs: lines.filter((line) => line.ours && !line.portal).length,
    onlyPortal: lines.filter((line) => !line.ours && line.portal).length,
  };
}

function sorted(lines: Line[]): Line[] {
  return [...lines].sort(
    (left, right) =>
      left.courseCode.localeCompare(right.courseCode, undefined, { numeric: true }) ||
      left.crn.localeCompare(right.crn, undefined, { numeric: true }),
  );
}
