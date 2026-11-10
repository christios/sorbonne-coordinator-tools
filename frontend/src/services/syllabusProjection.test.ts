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
  // The second is a syllabus whose graded activities live in its schedule (November 2026).
  it.each(["syllabus-export-parity.json", "syllabus-export-parity-v2.json"])("says the same thing as %s, cell for cell", (name) => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, `../../../fixtures/${name}`), "utf8"));
    const { expected, ...syllabus } = fixture;

    expect(previewProjection(syllabus)).toEqual(expected);
  });
});
