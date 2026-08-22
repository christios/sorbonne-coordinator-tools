/**
 * The extension's filter check, tested from here because this repository is where the
 * test runner lives. Outside src/ because it exercises the extension's plain JavaScript
 * rather than the application's own code. It is the boundary that decides what the platform may ask the
 * registrar portal, so it is worth pinning precisely.
 */

import { describe, expect, it } from "vitest";

import { checkFilter } from "../../extension/filter-schema.js";

const FIELDS = [
  { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY" }, { value: "L1" }] },
  { key: "MAJOR_CODE", label: "Major", options: [{ value: "MATH" }, { value: "PHYS" }] },
  { key: "SEARCH_TEXT", label: "Anything", options: [] },
];

/** What the extension read from the portal is complete, so it is enforced. */
const FROM_PORTAL = { trustValues: true };

describe("what the extension will ask the portal", () => {
  it("allows a filter the schema knows", () => {
    expect(checkFilter({ YEARLEVEL_CODE: ["FY", "L1"], MAJOR_CODE: ["MATH"] }, FIELDS, FROM_PORTAL)).toBeNull();
  });

  it("refuses a field the portal never offered", () => {
    expect(checkFilter({ SOME_FIELD: ["X"] }, FIELDS, FROM_PORTAL)).toBe("unknown_field:SOME_FIELD");
  });

  it("never filters by a sensitive column, whatever the schema says", () => {
    // Filtering by passport is a question in itself: the row count answers it. So these
    // are refused with a learned schema, an unlearned one, and even if one offered them.
    const offered = [{ key: "PASSPORT_ID", options: [{ value: "X" }], verified: true }];

    for (const fields of [FIELDS, [], offered]) {
      expect(checkFilter({ PASSPORT_ID: ["X"] }, fields)).toBe("sensitive_field:PASSPORT_ID");
      expect(checkFilter({ PASSPORT_ID: ["X"] }, fields, FROM_PORTAL)).toBe("sensitive_field:PASSPORT_ID");
    }
    expect(checkFilter({ MOBILE_NO: ["050"] }, [])).toBe("sensitive_field:MOBILE_NO");
  });

  it("refuses a value the field does not offer", () => {
    expect(checkFilter({ YEARLEVEL_CODE: ["L9"] }, FIELDS, FROM_PORTAL)).toBe(
      "value_not_offered:YEARLEVEL_CODE=L9",
    );
  });

  it("does not enforce a hand-written list that was never verified", () => {
    // The August fallback had ESTS_CODE wrong. Enforcing it would have blocked the right
    // code, so an unverified list is a suggestion and only the shape is checked.
    const guessed = [{ key: "ESTS_CODE", label: "Enrolment status", options: [{ value: "NA" }] }];

    expect(checkFilter({ ESTS_CODE: ["EL"] }, guessed)).toBeNull();
    expect(checkFilter({ ESTS_CODE: ["EL"] }, guessed, FROM_PORTAL)).toBe("value_not_offered:ESTS_CODE=EL");
  });

  it("enforces a fallback field that was checked against live counts", () => {
    const verified = [{ key: "YEARLEVEL_CODE", options: [{ value: "FY" }], verified: true }];

    expect(checkFilter({ YEARLEVEL_CODE: ["L9"] }, verified)).toBe("value_not_offered:YEARLEVEL_CODE=L9");
  });

  it("lets an unlearned schema through by shape, since its field list is incomplete", () => {
    expect(checkFilter({ SOME_NEW_FIELD: ["X"] }, FIELDS)).toBeNull();
  });

  it("allows any value for a field with no fixed list, within reason", () => {
    expect(checkFilter({ SEARCH_TEXT: ["Haddad"] }, FIELDS, FROM_PORTAL)).toBeNull();
    expect(checkFilter({ SEARCH_TEXT: ["'; DROP TABLE"] }, FIELDS, FROM_PORTAL)).toBe("bad_value:SEARCH_TEXT");
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
