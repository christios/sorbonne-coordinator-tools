import { describe, expect, it } from "vitest";

import {
  clashesOf,
  endOf,
  groupWords,
  mayShareStudents,
  plannedHours,
  studentsOf,
  weeksSaid,
  type Place,
  type Plan,
  type PlanClass,
  type PlanSection,
} from "@/services/semesterPlans";

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
    duration: "",
    places: [],
    gone: false,
    comments: "",
    position: 0,
    updatedAt: "",
    updatedBy: "",
    ...fields,
  };
}

/** A group of a set of a cohort, as Groups & CRNs places a class. */
function at(cohort: string, set: string, group: string, fields: Partial<Place> = {}): Place {
  return {
    cohortId: cohort,
    cohort,
    setId: `${cohort}-${set}`,
    set,
    parentSetId: "",
    openToAll: false,
    onlyGroup: false,
    groupId: `${cohort}-${set}-${group}`,
    group,
    parentGroupIds: [],
    parallelWith: [],
    majorId: "",
    majors: [],
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

describe("whose students two groups of Groups & CRNs are", () => {
  const td1 = at("L1-S2", "TD", "1");
  const td2 = at("L1-S2", "TD", "2");

  it("keeps the groups of one set apart, and the cohorts apart", () => {
    expect(studentsOf(td1, td1)).toBe("same");
    expect(studentsOf(td1, td2)).toBe("none");
    expect(studentsOf(td1, at("L2-S2", "TD", "1"))).toBe("none");
  });

  it("puts a nested group with the groups it goes with, and the cohort's one lecture with everybody", () => {
    const philosophy = at("L1-S2", "PHIL-TD", "1", { parentSetId: td1.setId, parentGroupIds: [td1.groupId] });
    expect(studentsOf(philosophy, td1)).toBe("same");
    expect(studentsOf(td2, philosophy)).toBe("none");
    expect(studentsOf(at("L1-S2", "CM", "1", { onlyGroup: true }), td2)).toBe("same");
  });

  it("cannot say for a language group or two sets that cut the cohort differently", () => {
    expect(studentsOf(td1, at("FYS-S2", "LANG", "A0-F1", { openToAll: true }))).toBe("maybe");
    expect(studentsOf(td1, at("L1-S2", "MTP", "2A"))).toBe("maybe");
    // …but two language groups never share a student.
    expect(studentsOf(at("FYS-S2", "LANG", "A0-F1", { openToAll: true }), at("FYS-S2", "LANG", "A0-F2", { openToAll: true }))).toBe("none");
  });

  it("is what a clash between two such classes goes by", () => {
    const one = section("a", { places: [td1] });
    const other = section("b", { courseCode: "PHYS-126", places: [td2] });
    const lecture = section("c", { courseCode: "MATH-114", places: [at("L1-S2", "CM", "1", { onlyGroup: true })] });
    expect(mayShareStudents(one, other)).toBe(false);
    expect(mayShareStudents(one, lecture)).toBe(true);
  });
});

describe("how long a class dropped on the week is", () => {
  it("is one session as Groups & CRNs says it, or the slot when it says none or two", () => {
    expect(endOf(section("a", { duration: "1.5" }), "08:30", "10:00")).toBe("10:00");
    expect(endOf(section("a", { duration: "3" }), "13:00", "14:30")).toBe("16:00");
    expect(endOf(section("a", { duration: "1, 2" }), "13:00", "14:30")).toBe("14:30");
    expect(endOf(section("a"), "13:00", "14:30")).toBe("14:30");
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

  it("calls a class from Groups & CRNs by its set and group", () => {
    expect(groupWords(section("a", { component: "TD", groupLabel: "RDNS 3", places: [at("FYS-S2", "RDNS", "3")] }), false)).toBe("RDNS 3");
  });

  it("names one of several parallel classes with no group of its own", () => {
    const french = section("f", { component: "Language", title: "French A0 F4" });
    expect(groupWords(french, true)).toBe("French A0 F4");
    expect(groupWords(section("cm", { component: "CM" }), false)).toBe("CM");
  });
});
