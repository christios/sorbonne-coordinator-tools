import { describe, expect, it } from "vitest";

import { clashesOf, groupWords, mayShareStudents, plannedHours, weeksSaid, type Plan, type PlanClass, type PlanSection } from "@/services/semesterPlans";

function section(id: string, fields: Partial<PlanSection> = {}): PlanSection {
  return {
    id,
    crn: id,
    parentCrn: "",
    courseCode: "MATH-002",
    title: "",
    ue: "",
    component: "TD",
    programmes: ["FYS"],
    groupLabel: "",
    teacherName: "",
    hours: null,
    hoursSaid: "",
    comments: "",
    position: 0,
    updatedAt: "",
    updatedBy: "",
    ...fields,
  };
}

function lesson(sectionId: string, fields: Partial<PlanClass> = {}): PlanClass {
  return {
    seriesId: `series-${sectionId}`,
    sectionId,
    week: 1,
    meetsOn: "2027-01-12",
    weekday: 2,
    startsAt: "08:30",
    endsAt: "10:00",
    room: "",
    teacherName: "",
    moved: false,
    ...fields,
  };
}

function plan(sections: PlanSection[], classes: PlanClass[]): Plan {
  return {
    termCode: "262720",
    semesterId: "plan:262720",
    name: "S2",
    weekOne: "2027-01-11",
    weeks: 14,
    without: [],
    holidays: [],
    updatedAt: "",
    updatedBy: "",
    sections,
    series: [],
    classes,
    skipped: [],
  };
}

describe("weeks said the way a timetable says them", () => {
  it("runs consecutive weeks together", () => {
    expect(weeksSaid([1, 2, 3, 4, 5, 7, 9, 10, 11])).toBe("Weeks 1–5, 7, 9–11");
    expect(weeksSaid([6])).toBe("Week 6");
    expect(weeksSaid([])).toBe("No weeks");
  });
});

describe("which classes may share students", () => {
  it("keeps parallel groups of one course apart, and the lecture with every group", () => {
    const lecture = section("cm", { component: "CM" });
    const g1 = section("g1", { groupLabel: "G1" });
    const g2 = section("g2", { groupLabel: "G2" });
    expect(mayShareStudents(g1, g2)).toBe(false);
    expect(mayShareStudents(lecture, g1)).toBe(true);
  });

  it("does not count two French groups, but counts a French group against anything else of its year", () => {
    const french = section("f1", { courseCode: "SCEN-101", component: "Language" });
    const other = section("f2", { courseCode: "SCEN-101", component: "Language" });
    const tutorial = section("td", { courseCode: "MATH-006", groupLabel: "G3" });
    expect(mayShareStudents(french, other)).toBe(false);
    expect(mayShareStudents(french, tutorial)).toBe(true);
  });

  it("says nothing across programmes", () => {
    expect(mayShareStudents(section("a"), section("b", { programmes: ["L1"], courseCode: "MATH-114" }))).toBe(false);
  });
});

describe("clashes", () => {
  it("finds the same teacher and the same room at overlapping hours, and not back-to-back classes", () => {
    const a = section("a", { courseCode: "MATH-002", programmes: ["L2"] });
    const b = section("b", { courseCode: "PHYS-203", programmes: ["L3"] });
    const first = lesson("a", { teacherName: "Samar Ghantous", room: "5.104" });
    const second = lesson("b", { startsAt: "09:30", endsAt: "11:00", teacherName: "samar ghantous", room: "5.104" });
    const after = lesson("b", { seriesId: "later", startsAt: "10:00", endsAt: "11:30", teacherName: "Samar Ghantous" });
    const found = clashesOf(plan([a, b], [first, second]));
    expect(found.get(first)?.map((clash) => clash.kind).sort()).toEqual(["room", "teacher"]);
    expect(clashesOf(plan([a, b], [first, after])).size).toBe(0);
  });
});

describe("hours placed", () => {
  it("adds up each class's length", () => {
    const placed = plannedHours(plan([section("a")], [lesson("a"), lesson("a", { week: 2, startsAt: "10:15", endsAt: "11:15" })]));
    expect(placed.get("a")).toBe(2.5);
  });
});

describe("what a box calls a class's group", () => {
  it("puts the type before a group, once", () => {
    expect(groupWords(section("a", { component: "TD", groupLabel: "G1" }), false)).toBe("TD G1");
    expect(groupWords(section("b", { component: "TD", groupLabel: "TD 2" }), false)).toBe("TD 2");
  });

  it("names one of several parallel classes with no group of its own", () => {
    const french = section("f", { component: "Language", title: "French A0 F4" });
    expect(groupWords(french, true)).toBe("French A0 F4");
    expect(groupWords(section("cm", { component: "CM" }), false)).toBe("CM");
  });
});
