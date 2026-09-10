import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseRecord } from "@/components/CourseRecord";
import * as lists from "@/services/portalLists";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const EMPTY_CHECK = {
  gone: [], arrived: [], unregistered: [], teacherDiffers: [], teacherUnnamed: [],
  collides: [], settledCollisions: [], swept: true,
} as unknown as lists.RegisterCheck;

const CATALOGUE: database.CohortCatalogue[] = [
  {
    cohort: { id: "c3", name: "L3-S1", term: "2026-27" },
    scopes: [
      {
        id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared",
        parentScopeId: "", openToAll: false,
        courses: [{ id: "cm-alg", code: "MATH-351", name: "Algebra & Cryptography", component: "CM", program: "", request: database.EMPTY_REQUEST }],
        groups: [
          {
            id: "cm-a", label: "Mathematics", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 8,
            crns: {
              "cm-alg": {
                ...database.EMPTY_SECTION,
                crn: "23436", teacher: "Grace Younes", hours: "15",
                parts: [
                  { ...database.EMPTY_PART, part: 1, crn: "23436", teacher: "Grace Younes", hours: "15" },
                  { ...database.EMPTY_PART, part: 2, crn: "24311", teacher: "Sudarshan Shinde", hours: "15" },
                ],
              },
            },
          },
        ],
      },
    ],
  },
];

function show(courseCode = "MATH-351") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CourseRecord open courseCode={courseCode} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([
    { id: "a1", courseCode: "MATH-351", title: "Algebra & Cryptography", ue: "LU3MA276", mutualized: "", addedAt: "", addedBy: "", crnCount: 2, portalCrnCount: 2, termCount: 1, lastTerm: "262710", portalParentCrn: "24264" },
  ] as never);
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([
    { id: "1", termCode: "262710", crn: "23436", courseCode: "MATH-351", parentCrn: "24264", courseTitle: "", ue: "", mutualized: "", portalTitle: "" },
    { id: "2", termCode: "262710", crn: "24311", courseCode: "MATH-351", parentCrn: "24264", courseTitle: "", ue: "", mutualized: "", portalTitle: "" },
  ] as never);
  vi.spyOn(lists, "fetchTermCrns").mockResolvedValue({
    portalTermCode: "262710",
    crns: {
      "23436": { courseCode: "MATH-351", title: "", teacherName: "Grace Younes", status: "in_portal" },
      "24311": { courseCode: "MATH-351", title: "", teacherName: "Sudarshan Shinde", status: "in_portal" },
    },
  } as never);
  vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue(EMPTY_CHECK);
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue(CATALOGUE);
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1" } as unknown as timetables.TimetableTerm,
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("a course, in full", () => {
  it("shows every CRN the register holds, with the portal's word beside ours", async () => {
    show();

    /*
     * Scoped to the card AND awaited inside it. The headings are static and resolve while
     * every query is still in flight, and the CRNs appear in two cards at once — the
     * register's and the one saying where we teach it — which is the point of both.
     */
    const register = (await screen.findByText("In the register")).closest("section") as HTMLElement;
    expect(await within(register).findByText("23436")).toBeTruthy();
    expect(within(register).getByText("24311")).toBeTruthy();
    // The portal's word arrives after the register's, because it is asked for the term
    // the register says these CRNs are in.
    expect(await within(register).findByText("Grace Younes")).toBeTruthy();
  });

  it("shows where it is taught, down to the group and the stretch", async () => {
    /*
     * A course was the only thing on these pages with no place of its own: its CRNs were a
     * filtered register, where it is taught was a card on another page, and what was wrong
     * with it was a line in a banner naming it in passing.
     */
    show();

    const taught = (await screen.findByText("Where we teach it")).closest("section") as HTMLElement;
    expect(await within(taught).findByText("L3-S1")).toBeTruthy();
    // The group once per stretch of teaching, which is what a handover looks like here.
    expect(within(taught).getAllByText("Mathematics")).toHaveLength(2);
    expect(within(taught).getByText("Grace Younes")).toBeTruthy();
    expect(within(taught).getByText("Sudarshan Shinde")).toBeTruthy();
    expect(within(taught).getByText(/part 2 of 2/)).toBeTruthy();
  });

  it("says plainly when nothing is wrong with it", async () => {
    show();

    expect(await screen.findByText(/Nothing\. Every CRN it holds is registered/)).toBeTruthy();
  });

  it("shows only the differences that name this course", async () => {
    // The banner it replaces named a course in passing among everyone else's.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY_CHECK,
      unregistered: [
        { crn: "23436", courseCode: "MATH-351" },
        { crn: "99999", courseCode: "PHYS-303" },
      ],
    } as unknown as lists.RegisterCheck);

    show();

    const line = await screen.findByText(/23436 — on a card, and registered nowhere/);
    const wrong = line.closest("section") as HTMLElement;
    expect(within(wrong).queryByText(/99999/)).toBeNull();
  });

  it("says where to start for a course that is in no register and on no card", async () => {
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
    vi.spyOn(database, "fetchCourseCards").mockResolvedValue([]);

    show("PHYS-999");

    expect(await screen.findByText(/Take the course in on Active courses/)).toBeTruthy();
    expect(screen.getByText(/Add it to a set on Group schema/)).toBeTruthy();
  });
});
