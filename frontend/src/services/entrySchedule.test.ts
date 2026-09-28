import { describe, expect, it } from "vitest";

import { scheduleFromEntries, timetablesFilename } from "@/services/entrySchedule";

const MONDAY = { meetsOn: "2026-09-07", startsAt: "08:30", endsAt: "10:00", room: "5.101" };
const NEXT_MONDAY = { ...MONDAY, meetsOn: "2026-09-14" };

const read = {
  sections: async () => ({
    termCode: "262710",
    pulledAt: "2026-09-20T00:00:00+00:00",
    sections: [
      { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published" as const, meetings: [MONDAY, NEXT_MONDAY] },
      { crn: "22610", courseCode: "PHYS-210", title: "Maths for Physics", teacherName: "Gianluca Mola", state: "published" as const, meetings: [MONDAY, NEXT_MONDAY] },
    ],
  }),
  notes: async () => [],
  links: async () => ({ "term-1": "262710" }),
  weeks: async () => ({ "term-1": { weekOne: "2026-09-07", without: [] } }),
  semesterNames: async () => ({ "term-1": "Semester 1" }),
};

describe("a record's calendar as a timetable", () => {
  it("draws their own sections every week, and a cover only on the date they stood in", async () => {
    const input = await scheduleFromEntries(
      [
        { termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra", group: "TD 1" },
        { termCode: "262710", crn: "22610", code: "", title: "", onlyOn: ["2026-09-14"], standingIn: true },
      ],
      { title: "Grace Younes", subtitle: "Teacher" },
      read,
      "Grace Younes",
    );

    expect(input).toMatchObject({ title: "Grace Younes", subtitle: "Teacher   ·   Semester 1", semester: "Semester 1", weekOne: { weekOne: "2026-09-07", without: [] } });
    const [algebra, cover] = [input.sections.find((s) => s.crn === "23436"), input.sections.find((s) => s.crn === "22610")];
    expect(algebra?.meetings).toHaveLength(2);
    expect(algebra?.group).toBe("TD 1");
    // Somebody else's class: its course and teacher from the portal, on the one date covered.
    expect(cover).toMatchObject({ courseCode: "PHYS-210", teacher: "Gianluca Mola" });
    expect(cover?.meetings.map((meeting) => meeting.meetsOn)).toEqual(["2026-09-14"]);
    expect(cover?.notes).toEqual([
      { meetsOn: "2026-09-14", startsAt: "08:30", kind: "covered", coverTeacherName: "Grace Younes", note: "" },
    ]);
  });

  it("names whoever the note says covered a class, where the grid is several teachers'", async () => {
    const input = await scheduleFromEntries(
      [{ termCode: "262710", crn: "22610", code: "", title: "", onlyOn: ["2026-09-14"], standingIn: true }],
      { title: "Ahmed Slimani, Grace Younes", subtitle: "2 teachers" },
      {
        ...read,
        notes: async () => [
          {
            id: "n1", termCode: "262710", crn: "22610", meetsOn: "2026-09-14", startsAt: "08:30", endsAt: "10:00",
            kind: "covered", coverTeacherId: "", coverTeacherName: "Grace Younes", note: "", createdBy: "", createdAt: "",
          } as never,
        ],
      },
    );

    expect(input.sections[0].notes[0]).toMatchObject({ kind: "covered", coverTeacherName: "Grace Younes" });
  });

  it("names the file after the one person, or counts several", () => {
    expect(timetablesFilename(["Grace Younes"], "teachers")).toBe("Grace-Younes-timetable.pdf");
    expect(timetablesFilename(["A", "B", "C"], "students")).toBe("timetables-3-students.pdf");
  });
});

describe("a term linked to two semesters", () => {
  it("counts its weeks from whichever of them says where Week 1 is", async () => {
    const input = await scheduleFromEntries(
      [{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }],
      { title: "Grace Younes" },
      {
        ...read,
        links: async () => ({ "term-old": "262710", "term-1": "262710" }),
        weeks: async () => ({ "term-1": { weekOne: "2026-09-07", without: [] } }),
      },
    );
    expect(input.weekOne).toEqual({ weekOne: "2026-09-07", without: [] });
  });
});
