import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { previewProjection } from "./syllabusProjection";

/**
 * The export preview and the exported document are two renderings of one syllabus.
 * Both are held against the same fixture — the document in test_syllabus_export.py —
 * so a difference between them fails here rather than reaching the Provost.
 */
describe("Export preview against the generated document", () => {
  it("says the same thing, cell for cell", () => {
    const fixture = JSON.parse(
      readFileSync(resolve(__dirname, "../../../fixtures/syllabus-export-parity.json"), "utf8"),
    );
    const { expected, ...syllabus } = fixture;

    expect(previewProjection(syllabus)).toEqual(expected);
  });
});
