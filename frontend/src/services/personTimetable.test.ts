import { describe, expect, it } from "vitest";

import { mergedTeacherTimetable, otherGroupsOf, studentTimetable, type Placement } from "@/services/personTimetable";
import type { Registration } from "@/services/portalLists";
import type { CatalogueScope } from "@/services/studentDatabase";

const scope = { id: "scope-td", code: "TD", termId: "term-1" } as CatalogueScope;
const placement: Placement = {
  scope,
  group: { id: "td-1", label: "1", majors: [] } as unknown as Placement["group"],
  major: null,
  crns: [{ courseId: "c-algo", courseCode: "MATH-011", courseName: "Algorithms", crn: "23652" }],
};
const registered = (crn: string): Registration => ({
  termCode: "262710", crn, courseCode: "MATH-011", title: "Algorithms", teacherName: "", status: "in_portal", lastSeenAt: "",
});
const links = { "term-1": "262710" };

describe("a student's week", () => {
  it("draws a group's section they are registered for, solid", () => {
    const [entry] = studentTimetable({ placements: [placement], excused: new Set(), links, registrations: [registered("23652")] });
    expect(entry).toMatchObject({ crn: "23652", tone: "solid", group: "TD 1" });
  });

  it("leaves off a course they are exempt from and not registered for", () => {
    expect(studentTimetable({ placements: [placement], excused: new Set(["c-algo"]), links, registrations: [] })).toEqual([]);
  });

  it("draws a course they are exempt from, dashed and saying so, where the registrar still has them in it", () => {
    const [entry, ...rest] = studentTimetable({
      placements: [placement],
      excused: new Set(["c-algo"]),
      links,
      registrations: [registered("23652")],
    });
    expect(entry).toMatchObject({ crn: "23652", tone: "outline", group: "TD 1 · exempt" });
    // Once, as the group's section — not a second time as a registration outside their groups.
    expect(rest).toEqual([]);
  });
});

describe("several teachers' weeks on one grid", () => {
  const section = (crn: string, code = "PHYS-221") => ({ termCode: "262710", crn, code, title: "", group: "CM Physics" });
  const cover = (crn: string, dates: string[]) => ({ termCode: "262710", crn, code: "", title: "", onlyOn: dates, standingIn: true });

  it("names the teacher chosen in each box, and draws a section two of them share once with both", () => {
    const merged = mergedTeacherTimetable([
      { teacher: { fullName: "Ahmed Slimani" }, entries: [section("23450"), section("24240")] },
      { teacher: { fullName: "Grace Younes" }, entries: [section("23450"), section("22606", "PHYS-208")] },
    ]);

    expect(merged.map((entry) => [entry.crn, entry.staff])).toEqual([
      ["23450", "Ahmed Slimani & Grace Younes"],
      ["24240", "Ahmed Slimani"],
      ["22606", "Grace Younes"],
    ]);
  });

  it("does not draw a covered class twice when its owner is on the grid too", () => {
    const merged = mergedTeacherTimetable([
      { teacher: { fullName: "Ahmed Slimani" }, entries: [section("23450")] },
      { teacher: { fullName: "Grace Younes" }, entries: [cover("23450", ["2026-10-01"])] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ crn: "23450", staff: "Ahmed Slimani" });
  });

  it("draws a class covered for somebody not chosen on every date covered, once", () => {
    const merged = mergedTeacherTimetable([
      { teacher: { fullName: "Ahmed Slimani" }, entries: [cover("24272", ["2026-10-01"])] },
      { teacher: { fullName: "Grace Younes" }, entries: [cover("24272", ["2026-10-08", "2026-10-01"])] },
    ]);

    expect(merged).toEqual([expect.objectContaining({ crn: "24272", standingIn: true, onlyOn: ["2026-10-01", "2026-10-08"] })]);
  });
});

describe("the other groups of a set", () => {
  it("names the group each of the set's other CRNs belongs to, and leaves out their own", () => {
    // Moved from RDNS 9 to RDNS 10: 9's section is still where the registrar has them.
    const rdns = {
      id: "scope-rdns",
      code: "RDNS",
      groups: [
        { id: "g9", label: "9", crns: { readiness: { crn: "24006" } } },
        { id: "g10", label: "10", crns: { readiness: { crn: "24007" } } },
        { id: "g11", label: "11", crns: { readiness: { crn: "", parts: [{ crn: "24008" }, { crn: "24018" }] } } },
      ],
    } as unknown as CatalogueScope;

    const others = otherGroupsOf({
      scope: rdns,
      group: rdns.groups[1],
      major: null,
      crns: [{ courseId: "readiness", courseCode: "SCEN-102", courseName: "Maths Readiness", crn: "24007" }],
    });

    expect([...others]).toEqual([["24006", "9"], ["24008", "11"], ["24018", "11"]]);
  });
});
