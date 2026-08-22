/**
 * The extension's filter check, tested from here because this repository is where the
 * test runner lives. It is the boundary that decides what the platform may ask the
 * registrar portal, so it is worth pinning precisely.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error - plain JavaScript shipped in the extension, no types alongside it.
import { checkFilter } from "../../../extension/filter-schema.js";

const FIELDS = [
  { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY" }, { value: "L1" }] },
  { key: "MAJOR_CODE", label: "Major", options: [{ value: "MATH" }, { value: "PHYS" }] },
  { key: "SEARCH_TEXT", label: "Anything", options: [] },
];

describe("what the extension will ask the portal", () => {
  it("allows a filter the schema knows", () => {
    expect(checkFilter({ YEARLEVEL_CODE: ["FY", "L1"], MAJOR_CODE: ["MATH"] }, FIELDS)).toBeNull();
  });

  it("refuses a field the portal never offered", () => {
    // The endpoint returns passports and balances; nothing may go looking for them.
    expect(checkFilter({ PASSPORT_ID: ["X"] }, FIELDS)).toBe("unknown_field:PASSPORT_ID");
  });

  it("refuses a value the field does not offer", () => {
    expect(checkFilter({ YEARLEVEL_CODE: ["L9"] }, FIELDS)).toBe("value_not_offered:YEARLEVEL_CODE=L9");
  });

  it("allows any value for a field with no fixed list, within reason", () => {
    expect(checkFilter({ SEARCH_TEXT: ["Haddad"] }, FIELDS)).toBeNull();
    expect(checkFilter({ SEARCH_TEXT: ["'; DROP TABLE"] }, FIELDS)).toBe("bad_value:SEARCH_TEXT");
  });

  it("refuses a field name that is not a field name", () => {
    expect(checkFilter({ "../../etc": ["x"] }, FIELDS)).toMatch(/^bad_field/);
  });

  it("refuses an empty or malformed filter", () => {
    expect(checkFilter({}, FIELDS)).toBe("filter_empty");
    expect(checkFilter(null, FIELDS)).toBe("filter_not_an_object");
    expect(checkFilter([["YEARLEVEL_CODE", "FY"]], FIELDS)).toBe("filter_not_an_object");
    expect(checkFilter({ YEARLEVEL_CODE: "FY" }, FIELDS)).toBe("bad_values:YEARLEVEL_CODE");
    expect(checkFilter({ YEARLEVEL_CODE: [] }, FIELDS)).toBe("bad_values:YEARLEVEL_CODE");
  });

  it("refuses a filter large enough to be an attack rather than a search", () => {
    const many = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [`FIELD_${index}`, ["x"]]),
    );
    expect(checkFilter(many, FIELDS)).toBe("too_many_fields");
    expect(checkFilter({ YEARLEVEL_CODE: Array(41).fill("FY") }, FIELDS)).toBe(
      "too_many_values:YEARLEVEL_CODE",
    );
  });

  it("still checks the shape when nothing has been learned from the portal yet", () => {
    // An empty schema must not become "anything goes".
    expect(checkFilter({ YEARLEVEL_CODE: ["FY"] }, [])).toBeNull();
    expect(checkFilter({ "bad key": ["FY"] }, [])).toMatch(/^bad_field/);
    expect(checkFilter({ YEARLEVEL_CODE: ["<script>"] }, [])).toBe("bad_value:YEARLEVEL_CODE");
  });
});
