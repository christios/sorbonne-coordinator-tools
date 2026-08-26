import { describe, expect, it } from "vitest";

import { describeFilter, filterLines } from "@/services/filterSummary";
import type { PortalField } from "@/services/scenRosters";

const FIELDS: PortalField[] = [
  { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY", label: "Foundation Year" }] },
  { key: "DEPT_CODE", label: "Department", options: [{ value: "SCEN", label: "Sciences & Engineering" }] },
];

describe("reading a view's filter back", () => {
  it("gives the portal's name for a field and for each value", () => {
    const [line] = filterLines({ YEARLEVEL_CODE: ["FY"] }, FIELDS);

    expect(line.field).toBe("Year level");
    expect(line.values).toEqual([{ value: "FY", label: "Foundation Year" }]);
    expect(line.key).toBe("YEARLEVEL_CODE");
  });

  it("keeps the code when the schema describes neither, and says so", () => {
    // A filter outlives the schema: a field the portal has stopped describing still has to
    // be readable, because it is still what the view is asking for.
    const [line] = filterLines({ TERM_CODE: ["262710"] }, FIELDS);

    expect(line.field).toBe("TERM_CODE");
    expect(line.unknownField).toBe(true);
    expect(line.values).toEqual([{ value: "262710", label: "262710" }]);
  });

  it("leaves out a field fixed to nothing, which narrows nothing", () => {
    expect(filterLines({ YEARLEVEL_CODE: ["FY"], MAJOR_CODE: [] }, FIELDS)).toHaveLength(1);
  });

  it("orders by what the fields are called, so the same filter always reads the same way", () => {
    const lines = filterLines({ YEARLEVEL_CODE: ["FY"], DEPT_CODE: ["SCEN"] }, FIELDS);
    expect(lines.map((line) => line.field)).toEqual(["Department", "Year level"]);
  });

  it("still summarises to one line for a caption", () => {
    expect(describeFilter({ YEARLEVEL_CODE: ["FY", "L1"] }, FIELDS)).toBe("Year level FY, L1");
  });
});
