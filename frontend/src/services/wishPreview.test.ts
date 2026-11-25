import { describe, expect, it } from "vitest";

import type { ReductionRules } from "@/services/hourReductions";
import type { WishCollection } from "@/services/teacherWishes";
import { SAMPLE_EMAIL, SAMPLE_TEACHER, previewSource, sampleReductions, yearOfTerm, type PreviewSemester } from "@/services/wishPreview";

const RULES: ReductionRules = {
  service: 192,
  rules: [
    { kind: "phd", group: "safir", label: "PhD students", unit: "students", rule: "5 h each, up to 20 h", per: 5, cap: 20 },
    { kind: "committees", group: "department", label: "University committees", unit: "committees", rule: "3 h each", per: 3, cap: null },
    {
      kind: "head",
      group: "department",
      label: "Head of programme",
      unit: "choice",
      rule: "By programme",
      per: null,
      cap: null,
      options: [
        { key: "master", label: "Master's programme", hours: 32 },
        { key: "fy", label: "Foundation Year", hours: 16 },
      ],
    },
  ],
};
// Closed long ago: the preview is open whatever the date.
const COLLECTION: WishCollection = {
  termCode: "262720", deadline: "2020-01-10", message: "Tell us by January.", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 2, cantCap: 12, openedAt: "", openedBy: "",
};
const SEMESTER: PreviewSemester = {
  term: "262720",
  name: "Semester 2 2026-27",
  collection: COLLECTION,
  calendar: { weekOne: "2027-01-11", weeks: 3, without: [], holidays: [] },
  weeks: [
    { week: 1, monday: "2027-01-11", holidays: [] },
    { week: 2, monday: "2027-01-18", holidays: [] },
  ],
  rules: RULES,
};

describe("the preview of a teacher's page", () => {
  it("is a full-timer who leads a course, on the semester's own settings, open whatever the deadline", async () => {
    const form = await previewSource(SEMESTER).form();
    expect([form.teacherName, form.email, form.semesterName]).toEqual([SAMPLE_TEACHER, SAMPLE_EMAIL, "Semester 2 2026-27"]);
    expect(form.collection).toEqual(COLLECTION);
    expect(form.window).toEqual({ open: true, deadline: "2020-01-10", reopenedUntil: "" });
    expect(form.reductions?.year).toBe("2026-2027");
    expect(form.coursePlans?.weeks).toHaveLength(2);
    expect(form.coursePlans?.courses.map((course) => [course.courseCode, course.components.CM.hours, course.components.TD.hours])).toEqual([
      ["SAMPLE-101", 24, 18],
    ]);
    expect(form.wishes).toBeNull();
  });

  it("has one department reduction set by the Head of Department, and none of the teacher's own yet", () => {
    const sheet = sampleReductions(RULES, "2026-2027");
    const head = sheet.items.find((item) => item.kind === "head");
    expect([head?.detail, head?.hours, head?.state]).toEqual(["master", 32, "set"]);
    expect(sheet.items.find((item) => item.kind === "phd")?.state).toBe("");
    expect([sheet.total, sheet.owed, sheet.declaredAt]).toEqual([32, 160, ""]);
  });

  it("answers every save as the server would, keeps it on the page only, and starts again from nothing", async () => {
    const source = previewSource(SEMESTER, () => "2026-11-25T09:00:00Z");
    // The teacher's own: worked out by the rules; the Head of Department's is not theirs to change.
    const declared = await source.saveReductions({ phd: { amount: 2 }, head: { detail: "fy" } }, "Two PhDs");
    const phd = declared.reductions?.items.find((item) => item.kind === "phd");
    expect([phd?.amount, phd?.hours, phd?.state]).toEqual([2, 10, "declared"]);
    expect(declared.reductions?.items.find((item) => item.kind === "head")?.detail).toBe("master");
    expect([declared.reductions?.total, declared.reductions?.owed, declared.reductions?.note]).toEqual([42, 150, "Two PhDs"]);

    const laid = await source.saveCoursePlans([{ courseCode: "SAMPLE-101", weeks: { CM: { "1": 1 } }, lengths: {}, note: "Exam in week 2" }]);
    const course = laid.coursePlans?.courses[0];
    expect([course?.weeks, course?.note, course?.answerSource]).toEqual([{ CM: { "1": 1 } }, "Exam in week 2", "lead"]);

    const sent = await source.saveAnswer({
      blocks: [{ id: "m", kind: "preference", days: [1, 2], from: 8, to: 10, repeat: "all", week: "", comment: "" }],
      limits: { maxDays: 3 },
      limitKinds: { maxDays: "constraint" },
      comments: { maxDays: "Research days" },
      needs: "",
      note: "",
      overCapReason: "",
      submit: true,
    });
    expect([sent.wishes?.status, sent.wishes?.submittedAt]).toEqual(["submitted", "2026-11-25T09:00:00Z"]);
    expect(sent.wishes?.lines.map((line) => [line.key, line.level, line.comment])).toEqual([
      ["m", "would", ""],
      ["maxDays", "must", "Research days"],
    ]);
    // What was saved is read back, as from the server.
    expect((await source.form()).wishes?.status).toBe("submitted");

    await source.signOut();
    const fresh = await source.form();
    expect([fresh.wishes, fresh.reductions?.declaredAt, fresh.coursePlans?.courses[0].weeks]).toEqual([null, "", {}]);
  });

  it("leaves the hour reductions out when their rules could not be read", async () => {
    const form = await previewSource({ ...SEMESTER, rules: null }).form();
    expect(form.reductions).toBeNull();
    expect(yearOfTerm("262710")).toBe("2026-2027");
  });
});
