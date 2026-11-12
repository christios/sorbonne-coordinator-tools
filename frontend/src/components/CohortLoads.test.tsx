import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CohortLoads } from "@/components/CohortLoads";
import { buildCards } from "@/services/courseCards";
import type { ActiveCourse, ActiveTeacher } from "@/services/portalLists";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";

const TEACHERS = [
  { id: "act-1", fullName: "Bilal Maaz", type: "Full Time", source: "portal" },
  { id: "act-2", fullName: "Jad Tarsissi", type: "Part-Time", source: "portal" },
] as ActiveTeacher[];

/** A cohort with one course: its lecture, a tutorial taught, and one nobody teaches yet. */
const CATALOGUES = [
  {
    cohort: { id: "fy", name: "Foundation Year", term: "2026-27" },
    scopes: [
      {
        id: "td", code: "TD", name: "TD", note: "", termId: "s1", kind: "shared", parentScopeId: "", openToAll: false,
        courses: [{ id: "c1", code: "MATH-001", name: "Pre-calculus", component: "TD", request: { ...EMPTY_REQUEST, hours: "50" } }],
        groups: [
          { id: "g1", label: "1", capacity: 30, note: "", parentGroupId: "", assigned: 30, crns: { c1: { ...EMPTY_SECTION, crn: "23223", teacherId: "act-2" } } },
          { id: "g2", label: "2", capacity: 30, note: "", parentGroupId: "", assigned: 29, crns: { c1: { ...EMPTY_SECTION, crn: "23224" } } },
        ],
      },
      {
        id: "cm", code: "CM", name: "CM", note: "", termId: "s1", kind: "shared", parentScopeId: "", openToAll: false,
        courses: [{ id: "c2", code: "MATH-001", name: "Pre-calculus", component: "CM", request: { ...EMPTY_REQUEST, hours: "50" } }],
        groups: [{ id: "g3", label: "1", capacity: 120, note: "", parentGroupId: "", assigned: 59, crns: { c2: { ...EMPTY_SECTION, crn: "22151", teacherId: "act-1" } } }],
      },
    ],
  },
] as unknown as CohortCatalogue[];

const cards = buildCards(CATALOGUES, () => "Semester 1", [{ id: "a1", courseCode: "MATH-001", coefficient: "15" } as ActiveCourse]);

function show(onOpenTeacher = vi.fn()) {
  render(<CohortLoads cards={cards} termIds={["s1"]} termLabel={() => "S1 · Semester 1"} teachers={TEACHERS} onOpenTeacher={onOpenTeacher} />);
  return onOpenTeacher;
}

afterEach(() => window.sessionStorage.clear());

describe("Teacher hours, cohort by cohort", () => {
  it("opens on the department: who teaches its hours, and each cohort's shares", () => {
    show();

    expect(screen.getByRole("button", { name: "Department", pressed: true })).toBeTruthy();
    const split = screen.getByText(/Who teaches the department/).closest("section") as HTMLElement;
    // 50 of 150 hours to a full-timer, 50 to a part-timer, 50 nobody's yet.
    expect(within(split).getByText("FT").closest("tr")?.textContent).toContain("50 · 33%");
    expect(within(split).getByText("Nobody yet").closest("tr")?.textContent).toContain("50 · 33%");
    expect(within(split).getByText("Total").closest("tr")?.textContent).toContain("150");
  });

  it("shows a cohort as the sheet does: its courses with their coefficient, and every section", () => {
    const opened = show();

    fireEvent.click(within(screen.getByRole("group", { name: "Cohort" })).getByRole("button", { name: "Foundation Year" }));

    expect(screen.getByText("Coeff. 15")).toBeTruthy();
    const tutorial = screen.getByText("23223").closest("tr") as HTMLElement;
    expect(tutorial.textContent).toContain("Jad Tarsissi");
    expect(tutorial.textContent).toContain("PT");
    expect((screen.getByText("23224").closest("tr") as HTMLElement).textContent).toContain("Nobody yet");
    // The lecture's 59 students, its 50 hours under CM.
    expect((screen.getByText("22151").closest("tr") as HTMLElement).textContent).toContain("59");
    // A name opens the teacher's record.
    fireEvent.click(within(tutorial).getByRole("button", { name: "Jad Tarsissi" }));
    expect(opened).toHaveBeenCalledWith({ id: "act-2", fullName: "Jad Tarsissi" });
  });

  it("is searched and filtered as the other tables are, and counts only what it shows", () => {
    show();
    fireEvent.click(within(screen.getByRole("group", { name: "Cohort" })).getByRole("button", { name: "Foundation Year" }));
    expect(screen.getByText("3 of 3 sections")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search sections"), { target: { value: "tarsissi" } });

    expect(screen.getByText("1 of 3 sections")).toBeTruthy();
    expect(screen.queryByText("22151")).toBeNull();
    // The split is the sections shown, and says so.
    const split = screen.getByText("Who teaches the hours of the sections shown").closest("section") as HTMLElement;
    expect(within(split).getByText("PT").closest("tr")?.textContent).toContain("50 · 100%");

    fireEvent.click(screen.getByRole("button", { name: "Every section" }));
    expect(screen.getByText("3 of 3 sections")).toBeTruthy();
  });
});
