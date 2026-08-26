/**
 * What a group workbook would change, and what the coordinator ticked of it.
 *
 * Pure, for the same reason `timetableDiff` is: these are the rules with teeth. Which rows
 * are offered, what a block-level tick reaches, and exactly which operations get posted.
 *
 * Every row arrives carrying the operation it stands for, so approving is a filter and not
 * a translation — what the screen shows and what it sends are the same object. There is no
 * second place for the two to disagree.
 *
 * Nothing starts ticked. A workbook re-uploaded after a hand correction is mostly rows that
 * already agree; the few that differ are the ones somebody has to decide about, and a
 * pre-ticked box is not a decision.
 */

/** A Reference-sheet decision: a block's course, one of its groups, or a single CRN cell. */
export type ReferenceRow = {
  kind: "course" | "group" | "cell";
  op: string;
  key: string;
  status: "added" | "changed";
  label: string;
  detail: string;
  scopeCode: string;
  /** Present on a cell row: what the catalogue holds now, and what the workbook says. */
  before?: string;
  after?: string;
} & Record<string, unknown>;

export type ReferenceBlock = {
  scopeCode: string;
  scopeName: string;
  /** True when the semester holds no block by this code — the whole thing would be new. */
  isNew: boolean;
  unchanged: number;
  rows: ReferenceRow[];
};

/** A student sheet's decision: where the workbook would put one student, in one block. */
export type PlacementRow = {
  key: string;
  op: "place";
  status: "placed" | "moved";
  studentId: string;
  scopeCode: string;
  /** The group they are in now — empty when nobody has placed them. */
  before: string;
  after: string;
  groupId: string;
  detail: string;
};

export type ReferenceSummary = {
  blocksNew: number;
  groupsAdded: number;
  coursesAdded: number;
  crnsChanged: number;
  crnsAdded: number;
  unchanged: number;
  decisions: number;
};

export type PlacementSummary = {
  placed: number;
  moved: number;
  unchanged: number;
  unknownGroups: number;
  unknownStudents: number;
  decisions: number;
};

export type WorkbookPreview = {
  filename: string;
  sheet: string;
  style: "cohort" | "language";
  reference: { blocks: ReferenceBlock[]; summary: ReferenceSummary };
  placements: {
    rows: PlacementRow[];
    unchanged: number;
    /** "TD 7" — a group the student sheets name and the catalogue does not have. */
    unknownGroups: string[];
    /** Ids in the workbook that this cohort does not hold, so they are not offered. */
    unknownStudents: string[];
    summary: PlacementSummary;
    /** Why no placements were read, when the file carries none. Not an error. */
    note: string;
  };
};

export type Operation = Record<string, unknown> & { op: string };

/** Every key in the reference half, in the order the screen lists them. */
export function referenceKeys(blocks: ReferenceBlock[]): string[] {
  return blocks.flatMap((block) => block.rows.map((row) => row.key));
}

export function placementKeys(rows: PlacementRow[]): string[] {
  return rows.map((row) => row.key);
}

export function allKeys(preview: WorkbookPreview): string[] {
  return [...referenceKeys(preview.reference.blocks), ...placementKeys(preview.placements.rows)];
}

export function countDecisions(preview: WorkbookPreview): number {
  return preview.reference.summary.decisions + preview.placements.summary.decisions;
}

/** Only the blocks with something to decide. An agreeing block is not worth a card. */
export function blocksWithDecisions(blocks: ReferenceBlock[]): ReferenceBlock[] {
  return blocks.filter((block) => block.rows.length > 0);
}

/**
 * The placements, grouped by the block they are in, moves first.
 *
 * A move is the row with consequences — somebody is sitting in a group today and the
 * workbook would put them elsewhere — so it goes above the students nobody has placed yet.
 */
export function placementsByBlock(rows: PlacementRow[]): { scopeCode: string; rows: PlacementRow[] }[] {
  const byBlock = new Map<string, PlacementRow[]>();
  for (const row of rows) {
    const held = byBlock.get(row.scopeCode);
    if (held) held.push(row);
    else byBlock.set(row.scopeCode, [row]);
  }

  return [...byBlock.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map(([scopeCode, group]) => ({
      scopeCode,
      rows: [...group].sort((left, right) => {
        if (left.status !== right.status) return left.status === "moved" ? -1 : 1;
        return left.studentId.localeCompare(right.studentId);
      }),
    }));
}

/** How many students currently sitting in a group would be moved by what is ticked. */
export function studentsMoved(rows: PlacementRow[], selected: Set<string>): number {
  const moved = rows.filter((row) => row.status === "moved" && selected.has(row.key));
  return new Set(moved.map((row) => row.studentId)).size;
}

/**
 * The operations to post, which is simply the ticked rows.
 *
 * They go back exactly as they came: each already carries its `op` and every field the
 * server needs, so nothing is rebuilt here and nothing can be rebuilt wrongly. The order
 * does not matter — the server sorts them so blocks and courses exist before the cells and
 * placements that hang off them.
 */
export function operationsFrom(preview: WorkbookPreview, selected: Set<string>): Operation[] {
  const rows: Operation[] = [
    ...preview.reference.blocks.flatMap((block) => block.rows),
    ...preview.placements.rows,
  ];
  return rows.filter((row) => selected.has(row.key as string));
}
