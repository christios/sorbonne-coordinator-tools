import { describe, expect, it } from "vitest";

import { buildCards } from "@/services/courseCards";
import type { FacilityHours } from "@/services/portalLists";
import { plannedTeachers, portalScheduleWarnings } from "@/services/portalSchedule";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";
import type { Dismissal } from "@/services/warningDismissals";

/** Maths Readiness: G.3 and G.6 given to Ahmed in our planning, G.10 too, G.9 to Amina. */
const CATALOGUE: CohortCatalogue[] = [
  {
    cohort: { id: "c1", name: "FYS-S1", term: "2026-27" },
    scopes: [
      {
        id: "s-rdns", code: "RDNS", name: "", note: "", termId: "term-1", kind: "nested", parentScopeId: "", openToAll: false,
        courses: [{ id: "readiness", code: "SCEN-102", name: "Maths Readiness", component: "TD", request: EMPTY_REQUEST }],
        groups: [
          { id: "g3", label: "3", capacity: 20, note: "", parentGroupId: "", assigned: 20, crns: { readiness: { ...EMPTY_SECTION, crn: "24000", teacherId: "ahmed", teacher: "Sachin Valera" } } },
          { id: "g6", label: "6", capacity: 20, note: "", parentGroupId: "", assigned: 10, crns: { readiness: { ...EMPTY_SECTION, crn: "24003", teacherId: "ahmed", teacher: "Sachin Valera" } } },
          { id: "g9", label: "9", capacity: 30, note: "", parentGroupId: "", assigned: 17, crns: { readiness: { ...EMPTY_SECTION, crn: "24006", teacherId: "amina" } } },
          { id: "g10", label: "10", capacity: 30, note: "", parentGroupId: "", assigned: 17, crns: { readiness: { ...EMPTY_SECTION, crn: "24007", teacherId: "ahmed" } } },
        ],
      },
    ],
  },
];
const CARDS = buildCards(CATALOGUE, () => "Semester 1", [], new Map());
const LINKS = { "term-1": "262710" };
const NAMES: Record<string, string> = { ahmed: "Ahmed Menaa", amina: "Amina Menaa", sachin: "Sachin Valera" };
const PLANNED = plannedTeachers(CARDS, LINKS, (id) => NAMES[id] ?? "");

/** The registrar's timetable as it stood: G.3 and G.6 still Sachin's, G.10 not timetabled. */
const TIMETABLE: Record<string, FacilityHours> = {
  "262710": {
    "24000": { courseCode: "SCEN-102", teacherName: "Sachin Valera", hours: 36 },
    "24003": { courseCode: "SCEN-102", teacherName: "Sachin Valera", hours: 36 },
    "24006": { courseCode: "SCEN-102", teacherName: "Amina Menaa", hours: 36 },
  },
};

const read = (who: string, registrar = TIMETABLE, decided = new Map<string, Dismissal>()) =>
  portalScheduleWarnings({ teacher: { id: who, fullName: NAMES[who] }, cards: CARDS, links: LINKS, registrar, planned: PLANNED, decided });

describe("a teacher's portal schedule against our planning", () => {
  it("says which sections we give them are not on their portal schedule, and which are not timetabled", () => {
    const ahmed = read("ahmed");

    expect(ahmed.map((warning) => [warning.kind, warning.label])).toEqual([
      ["not_on_portal", "2 not on portal"],
      ["not_timetabled", "1 not timetabled"],
    ]);
    expect(ahmed[0].sentence).toContain("SCEN-102 RDNS 3 (24000): Sachin Valera");
    expect(ahmed[1].lines.map((line) => line.crn)).toEqual(["24007"]);
  });

  it("says it from the other side too: sections the portal gives them that we give to somebody else", () => {
    const [sachin] = read("sachin");

    expect(sachin.kind).toBe("portal_only");
    expect(sachin.label).toBe("2 on portal, not ours");
    expect(sachin.sentence).toContain("ours is Ahmed Menaa");
  });

  it("is quiet where the two agree", () => {
    expect(read("amina")).toEqual([]);
  });

  it("names a section the portal shares between two people as theirs", () => {
    const shared = { "262710": { ...TIMETABLE["262710"], "24000": { courseCode: "SCEN-102", teacherName: "Sachin Valera, Ahmed Menaa", hours: 36 } } };

    expect(read("ahmed", shared)[0].lines.map((line) => line.crn)).toEqual(["24003"]);
  });

  it("says nothing of a semester whose timetable has not been read", () => {
    expect(read("ahmed", {})).toEqual([]);
  });

  it("holds a dismissal until the sections or the names on them change", () => {
    const [first] = read("ahmed");
    const decided = new Map([[first.key, { key: first.key, byEmail: "c@sorbonne.ae", byName: "Christian", at: "2026-10-07" }]]);

    expect(read("ahmed", TIMETABLE, decided)[0]).toMatchObject({ dismissed: true, dismissedBy: "Christian" });

    // The registrar moves G.6 to Ahmed: the warning is about one section now, and asks again.
    const moved = { "262710": { ...TIMETABLE["262710"], "24003": { courseCode: "SCEN-102", teacherName: "Ahmed Menaa", hours: 36 } } };
    expect(read("ahmed", moved, decided)[0]).toMatchObject({ label: "1 not on portal", dismissed: false });
  });
});
