import { describe, expect, it } from "vitest";

import { studentTimetable, type Placement } from "@/services/personTimetable";
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
