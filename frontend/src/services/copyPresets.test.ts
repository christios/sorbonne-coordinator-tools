import { beforeEach, describe, expect, it } from "vitest";

import {
  loadPresets,
  newPresetId,
  presetColumns,
  movePicked,
  presetText,
  reorderPicked,
  rowsForCopy,
  savePresets,
  type CopyPreset,
} from "@/services/copyPresets";
import type { StudentColumn } from "@/services/studentColumns";

const column = (id: string, displayName: string) =>
  ({ id, displayName, accessor: () => "" }) as unknown as StudentColumn;

const COLUMNS = [
  column("studentId", "Id"),
  column("portal:FULL_NAME", "Student"),
  column("portal:PSUAD_EMAIL", "E-mail"),
  column("cohort", "Cohort"),
];

const preset = (columnIds: string[]): CopyPreset => ({ id: "p1", name: "Mail merge", columnIds });

beforeEach(() => window.localStorage.clear());

describe("the columns a preset names", () => {
  it("returns them in the preset's order, not the table's", () => {
    const chosen = presetColumns(preset(["portal:PSUAD_EMAIL", "studentId"]), COLUMNS);

    expect(chosen.map((c) => c.displayName)).toEqual(["E-mail", "Id"]);
  });

  it("names columns the table is not showing, which is the point of it", () => {
    // The preset does not know or care what the layout hides.
    const chosen = presetColumns(preset(["cohort", "portal:FULL_NAME"]), COLUMNS);

    expect(chosen).toHaveLength(2);
  });

  it("drops a column nothing answers to any more, rather than refusing to copy", () => {
    // The portal stopped offering it, or this browser has never seen it.
    const chosen = presetColumns(preset(["studentId", "portal:GONE"]), COLUMNS);

    expect(chosen.map((c) => c.displayName)).toEqual(["Id"]);
  });
});

describe("which students a copy covers", () => {
  const rows = [{ studentId: "A001" }, { studentId: "A002" }, { studentId: "A003" }];

  it("takes everything shown when nothing is ticked", () => {
    expect(rowsForCopy(rows, new Set())).toHaveLength(3);
  });

  it("takes only the ticked ones when there are any", () => {
    expect(rowsForCopy(rows, new Set(["A001", "A003"]))).toEqual([
      { studentId: "A001" },
      { studentId: "A003" },
    ]);
  });

  it("keeps to what is on screen, so a filter still applies to a selection", () => {
    // Ticked before a filter hid them: copying them anyway would be the opposite of
    // what the filter was for.
    expect(rowsForCopy([{ studentId: "A001" }], new Set(["A001", "A002"]))).toEqual([
      { studentId: "A001" },
    ]);
  });
});

describe("what lands on the clipboard", () => {
  const rows = [{ studentId: "A001" }, { studentId: "A002" }];
  const cell = (row: { studentId: string }, col: StudentColumn) =>
    col.id === "studentId" ? row.studentId : `${row.studentId}@psuad.ac.ae`;
  const chosen = [COLUMNS[0], COLUMNS[2]];

  it("is tab separated, one line per student, with no header by default", () => {
    expect(presetText(chosen, rows, cell, false)).toBe(
      "A001\tA001@psuad.ac.ae\nA002\tA002@psuad.ac.ae",
    );
  });

  it("puts the column names on the first line when that is asked for", () => {
    expect(presetText(chosen, rows, cell, true)).toBe(
      "Id\tE-mail\nA001\tA001@psuad.ac.ae\nA002\tA002@psuad.ac.ae",
    );
  });

  it("quotes a value holding a tab or a newline, so it stays one cell", () => {
    const awkward = presetText(
      [COLUMNS[1]],
      [{ studentId: "A001" }],
      () => "Ada\tLovelace",
      false,
    );

    expect(awkward).toBe('"Ada\tLovelace"');
  });

  it("copies nothing but a header when no student is left to copy", () => {
    expect(presetText(chosen, [], cell, false)).toBe("");
    expect(presetText(chosen, [], cell, true)).toBe("Id\tE-mail");
  });
});

describe("keeping presets in this browser", () => {
  it("gives them back after the page has been left and returned to", () => {
    savePresets({ presets: [preset(["studentId"])], withHeader: true });

    expect(loadPresets()).toEqual({ presets: [preset(["studentId"])], withHeader: true });
  });

  it("starts with none, and without a header", () => {
    expect(loadPresets()).toEqual({ presets: [], withHeader: false });
  });

  it("ignores a stored file that is not ours, rather than breaking the menu", () => {
    window.localStorage.setItem("scen-copy-presets:v1", "not json");

    expect(loadPresets().presets).toEqual([]);
  });

  it("drops a misshapen preset and keeps the rest", () => {
    window.localStorage.setItem(
      "scen-copy-presets:v1",
      JSON.stringify({ presets: [{ id: "p1", name: "Good", columnIds: [] }, { name: "no id" }] }),
    );

    expect(loadPresets().presets.map((p) => p.name)).toEqual(["Good"]);
  });

  it("gives a new preset an id nothing else has", () => {
    const held = [preset(["studentId"])];

    expect(newPresetId(held)).not.toBe("p1");
    expect(newPresetId(held)).toBeTruthy();
  });
});

/*
 * The order columns copy in is the order they were ticked, which is rarely the order
 * they are wanted in. Dragging says so directly, and the arrows say it without a mouse.
 */
describe("putting the picked columns in order", () => {
  const ids = ["a", "b", "c", "d"];

  it("drops one in front of another", () => {
    expect(reorderPicked(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("drops one at the end when there is nothing to go in front of", () => {
    expect(reorderPicked(ids, "a", "")).toEqual(["b", "c", "d", "a"]);
  });

  it("leaves the order alone when something is dropped on itself", () => {
    expect(reorderPicked(ids, "b", "b")).toEqual(ids);
  });

  it("ignores a column that is not picked", () => {
    expect(reorderPicked(ids, "z", "b")).toEqual(ids);
  });

  it("moves one a place at a time", () => {
    expect(movePicked(ids, "c", -1)).toEqual(["a", "c", "b", "d"]);
    expect(movePicked(ids, "c", 1)).toEqual(["a", "b", "d", "c"]);
  });

  it("will not move the first one further left, or the last further right", () => {
    expect(movePicked(ids, "a", -1)).toEqual(ids);
    expect(movePicked(ids, "d", 1)).toEqual(ids);
  });
});
