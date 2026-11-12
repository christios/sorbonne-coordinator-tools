import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CohortLoads } from "@/components/CohortLoads";
import { buildCards } from "@/services/courseCards";
import { NO_COURSE_PROGRAMS, type CoursePrograms } from "@/services/coursePrograms";
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

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Teacher hours, cohort by cohort", () => {
  it("opens on the department: who teaches its hours, and each cohort's shares", () => {
    show();

    expect(screen.getByRole("button", { name: "Department", pressed: true })).toBeTruthy();
    const split = screen.getByText(/Who teaches the department/).closest("section") as HTMLElement;
    // 50 of 150 hours to a full-timer, 50 to a part-timer, 50 nobody's yet.
    expect(within(split).getByText("FT").closest("tr")?.textContent).toContain("5033%");
    expect(within(split).getByText("Nobody yet").closest("tr")?.textContent).toContain("5033%");
    expect(within(split).getByText("Total").closest("tr")?.textContent).toContain("150");
    // Every teacher of the department, with their hours and the cohorts they teach in.
    const teachers = screen.getByText("Each teacher in the department").closest("section") as HTMLElement;
    expect(within(teachers).getByText("Bilal Maaz").closest("li")?.textContent).toContain("Foundation Year");
    expect(within(teachers).getByText("Jad Tarsissi").closest("li")?.textContent).toContain("50");
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
    expect(within(split).getByText("PT").closest("tr")?.textContent).toContain("50100%");

    fireEvent.click(screen.getByRole("button", { name: "Every section" }));
    expect(screen.getByText("3 of 3 sections")).toBeTruthy();
  });
});

/** Foundation Year's Pre-calculus, and L1 with a Maths and a Physics course. */
const PROGRAMS_CATALOGUES = [
  CATALOGUES[0],
  {
    cohort: { id: "l1", name: "L1", term: "2026-27" },
    scopes: [
      {
        id: "l1-cm", code: "CM", name: "CM", note: "", termId: "s1", kind: "shared", parentScopeId: "", openToAll: false,
        courses: [
          { id: "m1", code: "MATH-100", name: "Mathematics 1", component: "CM", request: { ...EMPTY_REQUEST, hours: "45" } },
          { id: "p1", code: "PHYS-125", name: "Mechanics-Physics 1", component: "CM", request: { ...EMPTY_REQUEST, hours: "28" } },
        ],
        groups: [
          {
            id: "l1-g1", label: "1", capacity: 120, note: "", parentGroupId: "", assigned: 100,
            crns: { m1: { ...EMPTY_SECTION, crn: "22001", teacherId: "act-1" }, p1: { ...EMPTY_SECTION, crn: "22135", teacherId: "act-2" } },
          },
        ],
      },
    ],
  },
] as unknown as CohortCatalogue[];

/** SCEN's programmes (Settings → Programmes): MATH's codes are MATH and CPSC, PHYS's are PHYS. */
const SCEN: CoursePrograms = {
  programmes: [
    { code: "MATH", name: "Mathematics", officialName: "", registrarName: "Mathematics", aliases: [], prefixes: ["MATH", "CPSC"] },
    { code: "PHYS", name: "Physics", officialName: "", registrarName: "Physics", aliases: [], prefixes: ["PHYS"] },
  ],
  courses: {},
};

function showPrograms(programs: CoursePrograms = SCEN) {
  const both = buildCards(PROGRAMS_CATALOGUES, () => "Semester 1", []);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CohortLoads cards={both} termIds={["s1"]} termLabel={() => "S1 · Semester 1"} teachers={TEACHERS} programs={programs} />
    </QueryClientProvider>,
  );
}

describe("Teaching loads, by program and with the tabs one wants", () => {
  it("narrows every tab to one program's courses, by the course and not the students", () => {
    showPrograms();
    expect(within(screen.getByRole("group", { name: "Cohort" })).getByRole("button", { name: "Foundation Year" })).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Program" }));
    fireEvent.click(screen.getByRole("option", { name: "Physics" }));

    // Only Mechanics' 28 hours, all a part-timer's.
    const split = screen.getByText("Who teaches the department’s Physics hours").closest("section") as HTMLElement;
    expect(within(split).getByText("PT").closest("tr")?.textContent).toContain("28100%");
    expect(within(split).getByText("Total").closest("tr")?.textContent).toContain("28");
    // The Foundation Year teaches no Physics course, so it has no tab.
    const tabs = screen.getByRole("group", { name: "Cohort" });
    expect(within(tabs).queryByRole("button", { name: "Foundation Year" })).toBeNull();

    fireEvent.click(within(tabs).getByRole("button", { name: "L1" }));
    expect(screen.getByText("22135")).toBeTruthy();
    expect(screen.queryByText("22001")).toBeNull();
    expect(screen.getByText("1 of 1 sections")).toBeTruthy();
  });

  it("shows only the tabs ticked in its settings, remembers them, and always keeps one", () => {
    showPrograms();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const ticks = screen.getByRole("group", { name: "Tabs shown" });
    fireEvent.click(within(ticks).getByRole("checkbox", { name: "Foundation Year" }));
    // Put away, the Foundation Year is still the department's: counted, but not a tab to open.
    const comparison = screen.getByText("Cohort by cohort, over the year").closest("section") as HTMLElement;
    expect(within(comparison).getByText("Foundation Year").tagName).toBe("SPAN");
    expect(within(comparison).getByRole("button", { name: "L1" })).toBeTruthy();
    fireEvent.click(within(ticks).getByRole("checkbox", { name: "Department" }));

    const tabs = screen.getByRole("group", { name: "Cohort" });
    expect(within(tabs).getAllByRole("button").map((button) => button.textContent)).toEqual(["L1"]);
    // With Department put away, the first tab shown is the one open.
    expect(within(tabs).getByRole("button", { name: "L1", pressed: true })).toBeTruthy();
    expect(window.localStorage.getItem("scen-remembered:teaching-loads-hidden-tabs")).toBe("department\nfy");

    // The last tab shown cannot be put away.
    expect((within(ticks).getByRole("checkbox", { name: "L1" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("has no Program menu in a department with no programme, and points to where courses are grouped", () => {
    showPrograms(NO_COURSE_PROGRAMS);

    expect(screen.queryByRole("combobox", { name: "Program" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    // Which courses count as which programme is the whole application's, not this page's.
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Settings → Programmes" }).getAttribute("href")).toBe(
      "#/settings/programmes",
    );
  });

  it("counts a course where the department has put it", () => {
    // Mechanics said to be no program's: Physics has nothing left.
    showPrograms({ ...SCEN, courses: { "PHYS-125": "NONE" } });

    fireEvent.click(screen.getByRole("combobox", { name: "Program" }));
    fireEvent.click(screen.getByRole("option", { name: "Physics" }));

    expect(screen.getByText(/No Physics course is planned for this academic year yet/)).toBeTruthy();
  });
});
