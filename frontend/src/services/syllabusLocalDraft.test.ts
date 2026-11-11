import { afterEach, describe, expect, it } from "vitest";

import type { Syllabus } from "@/services/syllabi";
import { LOCAL_DRAFT_TTL, dropLocalDraft, keepLocalDraft, restoredDraft } from "@/services/syllabusLocalDraft";

const SAVED: Syllabus = {
  id: "syl-1", seriesId: "s", folderId: null, templateId: "scen-2025-26", courseTitle: "Optics", courseCode: "PHYS-118",
  academicYear: "2026-2027", revision: 4, createdAt: "", updatedAt: "", ownerEmail: null, visibility: "private", submittedAt: null,
  content: { description: { overview: "Saved." } },
};

afterEach(() => window.localStorage.clear());

describe("edits kept in the browser until they are saved", () => {
  it("brings back what was typed but not saved before a refresh, on the revision it was typed on", () => {
    keepLocalDraft({ ...SAVED, content: { description: { overview: "Saved, and then some." } } }, 1_000);

    const restored = restoredDraft(SAVED, 2_000);

    expect(restored?.content).toEqual({ description: { overview: "Saved, and then some." } });
    expect(restored?.revision).toBe(4);
  });

  it("keeps nothing once the server has the same thing, or once a week has passed", () => {
    keepLocalDraft(SAVED, 1_000);
    expect(restoredDraft(SAVED, 2_000)).toBeNull();

    keepLocalDraft({ ...SAVED, courseTitle: "Optics II" }, 1_000);
    expect(restoredDraft(SAVED, 1_000 + LOCAL_DRAFT_TTL + 1)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("forgets a syllabus's kept edits when told they are saved", () => {
    keepLocalDraft({ ...SAVED, courseTitle: "Optics II" });
    dropLocalDraft(SAVED.id);
    expect(restoredDraft(SAVED)).toBeNull();
  });
});
