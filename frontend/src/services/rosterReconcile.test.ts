import { describe, expect, it } from "vitest";

import { chosenCrn, courseFamilies, reconcile, withGroup } from "@/services/rosterReconcile";
import type { RosterCourse, RosterStudent } from "@/services/timetables";

const course = (crn: string, code: string, kind: string, group: string): RosterCourse => ({
  crn,
  code,
  kind,
  group,
  title: code,
  shortTitle: code,
  staff: "",
});

const COURSES = [
  course("22151", "MATH-001-CM-GR.A", "Lecture", "Gr. A"),
  course("22152", "MATH-001-CM-GR.B", "Lecture", "Gr. B"),
  course("23652", "MATH-011-TD-GR.1", "Tutorial", "Gr. 1"),
];

const student = (studentId: string, crns: string[], version = 0): RosterStudent => ({
  studentId,
  crns,
  version,
  updatedAt: "",
  updatedBy: "",
});

const portalRow = (id: string, name: string, year = "FY") => ({
  SPRIDEN_ID: id,
  FULL_NAME: name,
  YEARLEVEL_CODE: year,
});

describe("course families", () => {
  it("groups a course's sections into one choice", () => {
    const families = courseFamilies(COURSES);

    expect(families.map((family) => family.label)).toEqual(["MATH-001-CM", "MATH-011-TD"]);
    expect(families[0].options.map((option) => option.group)).toEqual(["Gr. A", "Gr. B"]);
  });

  it("falls back to the CRN when a section has no group label", () => {
    const [family] = courseFamilies([course("30001", "SCEN-101", "", "")]);

    expect(family.options[0].group).toBe("30001");
    // Nothing to strip, so the code is kept whole rather than losing its last segment.
    expect(family.label).toBe("SCEN-101");
  });

  it("keeps a code whose last segment is not the group", () => {
    expect(courseFamilies([course("30002", "SCEN-101-F1", "Language", "Gr. 2")])[0].label).toBe(
      "SCEN-101-F1",
    );
  });

  it("reads back which group a student holds", () => {
    const [maths] = courseFamilies(COURSES);

    expect(chosenCrn(maths, ["22152", "23652"])).toBe("22152");
    expect(chosenCrn(maths, ["23652"])).toBe("");
  });

  it("moving a student between groups leaves their other courses alone", () => {
    const [maths] = courseFamilies(COURSES);

    expect(withGroup(maths, ["22151", "23652"], "22152").sort()).toEqual(["22152", "23652"]);
  });

  it("clearing a group removes only that course", () => {
    const [maths] = courseFamilies(COURSES);

    expect(withGroup(maths, ["22151", "23652"], "")).toEqual(["23652"]);
  });
});

describe("reconcile", () => {
  it("shows the term's own students by id before anybody pulls", () => {
    const { rows, counts } = reconcile([student("A001", ["22151"])], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentId: "A001", name: "", status: "assigned" });
    expect(counts).toEqual({ assigned: 1, joined: 0, left: 0 });
  });

  it("marks a student the portal has and the term does not as joined", () => {
    const { rows, counts } = reconcile([], [portalRow("A002", "Amira Example")]);

    expect(rows[0]).toMatchObject({ studentId: "A002", name: "Amira Example", status: "joined", crns: [] });
    expect(counts.joined).toBe(1);
  });

  it("marks a student the term has and the portal does not as left", () => {
    const { counts } = reconcile([student("A003", ["22151"])], [portalRow("A002", "Amira Example")]);

    expect(counts).toEqual({ assigned: 0, joined: 1, left: 1 });
  });

  it("keeps a matched student's groups, version and editor", () => {
    const held = { ...student("A004", ["22151"], 3), updatedBy: "patricia@sorbonne.ae" };

    const [row] = reconcile([held], [portalRow("A004", "Karim Sample")]).rows;

    expect(row).toMatchObject({
      studentId: "A004",
      name: "Karim Sample",
      crns: ["22151"],
      version: 3,
      updatedBy: "patricia@sorbonne.ae",
      status: "assigned",
    });
  });

  it("matches ids case-insensitively, the way the portal writes them", () => {
    const { counts } = reconcile([student("a00021503", ["22151"])], [portalRow("A00021503", "Case Test")]);

    expect(counts).toEqual({ assigned: 1, joined: 0, left: 0 });
  });

  it("puts the work first: joined, then departures, then everybody else", () => {
    const { rows } = reconcile(
      [student("A001", ["22151"]), student("A009", ["22151"])],
      [portalRow("A001", "Stays"), portalRow("A100", "Joins")],
    );

    expect(rows.map((row) => row.status)).toEqual(["joined", "left", "assigned"]);
  });

  it("ignores a portal row with no id, and never lists anybody twice", () => {
    const { rows } = reconcile(
      [],
      [portalRow("", "No id"), portalRow("A005", "Twice"), portalRow("A005", "Twice")],
    );

    expect(rows.map((row) => row.studentId)).toEqual(["A005"]);
  });
});
