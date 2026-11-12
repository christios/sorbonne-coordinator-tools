import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProgrammesPanel } from "@/components/ProgrammesPanel";
import * as programs from "@/services/coursePrograms";
import * as lists from "@/services/portalLists";
import type { ActiveCourse } from "@/services/portalLists";
import * as codes from "@/services/programmeCodes";
import * as database from "@/services/studentDatabase";
import type { CohortCatalogue } from "@/services/studentDatabase";
import { sectionFrom } from "@/services/settingsSections";

/** SCEN's programmes, from its students: Mathematics, also written MATS; Physics. */
const SCEN: programs.CoursePrograms = {
  programmes: [
    {
      code: "MATH",
      name: "Mathematics",
      officialName: "",
      registrarName: "Mathematics",
      aliases: ["MATS"],
      prefixes: ["CPSC", "MATH"],
    },
    { code: "PHYS", name: "Physics", officialName: "", registrarName: "Physics", aliases: [], prefixes: ["PHYS"] },
  ],
  courses: { "SCEN-101": "NONE" },
};

function show(canChange: boolean, setup: programs.CoursePrograms = SCEN) {
  vi.spyOn(programs, "fetchCoursePrograms").mockResolvedValue(setup);
  // Planned on a card, and on the active list without one: both are listed.
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue([
    {
      cohort: { id: "fy" },
      scopes: [{ courses: [{ code: "SCEN-102", name: "Mathematics Readiness" }, { code: "SCEN-101", name: "Languages" }] }],
    },
  ] as unknown as CohortCatalogue[]);
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([
    { courseCode: "PHYS-125", title: "Mechanics-Physics 1" } as ActiveCourse,
    { courseCode: "MATH-100", title: "Mathematics 1" } as ActiveCourse,
  ]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProgrammesPanel canChange={canChange} />
    </QueryClientProvider>,
  );
}

/** A programme's card, by the code its heading starts with. */
const card = async (code: string) =>
  (await screen.findByRole("heading", { name: new RegExp(`^${code}\\b`) })).closest("li") as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe("Settings → Programmes", () => {
  it("shows each of the students' programmes with its other codes, its course codes, and every course", async () => {
    show(true);

    const maths = await card("MATH");
    expect(within(maths).getByText("MATS")).toBeTruthy();
    expect(within(maths).getByRole("combobox", { name: "Course codes under MATH" }).textContent).toContain("CPSC");
    expect(screen.getByRole("combobox", { name: "Programme of PHYS-125" }).textContent).toContain("As its code says (Physics)");
    expect(screen.getByRole("combobox", { name: "Programme of SCEN-102" }).textContent).toContain("As its code says (No programme)");
    expect(screen.getByRole("combobox", { name: "Programme of SCEN-101" }).textContent).toContain("No programme");
  });

  it("gives a programme its official name", async () => {
    const save = vi.spyOn(programs, "setOfficialName").mockResolvedValue(SCEN);
    show(true);

    const name = within(await card("MATH")).getByLabelText("Official name of MATH");
    fireEvent.change(name, { target: { value: "Bachelor of Science in Mathematics" } });
    fireEvent.click(within(await card("MATH")).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("MATH", "Bachelor of Science in Mathematics"));
  });

  it("says once that a recoded programme's new code is the same students, and can take it back", async () => {
    const add = vi.spyOn(codes, "setProgrammeCode").mockResolvedValue([]);
    const remove = vi.spyOn(codes, "removeProgrammeCode").mockResolvedValue([]);
    show(true);

    const maths = await card("MATH");
    fireEvent.change(within(maths).getByLabelText("Another code for MATH"), { target: { value: "mat" } });
    fireEvent.click(within(maths).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("mat", "MATH"));

    fireEvent.click(within(maths).getByRole("button", { name: "Stop treating MATS as MATH" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(remove.mock.calls[0][0]).toBe("MATS");
  });

  it("says why a code is refused, in the server's words", async () => {
    vi.spyOn(codes, "setProgrammeCode").mockRejectedValue(new Error("MATS already means MATH: say MAT means MATH instead."));
    show(true);

    const maths = await card("MATH");
    fireEvent.change(within(maths).getByLabelText("Another code for MATH"), { target: { value: "MAT" } });
    fireEvent.click(within(maths).getByRole("button", { name: "Add" }));

    expect(await within(maths).findByRole("alert")).toHaveProperty("textContent", "MATS already means MATH: say MAT means MATH instead.");
  });

  it("chooses a programme's course codes from those the courses use, never another programme's", async () => {
    const save = vi.spyOn(programs, "setProgrammePrefixes").mockResolvedValue(SCEN);
    show(true);

    fireEvent.click(within(await card("PHYS")).getByRole("combobox", { name: "Course codes under PHYS" }));
    const offered = screen.getAllByRole("option").map((option) => option.textContent);
    // SCEN is free; MATH and CPSC are Mathematics's, so Physics is not offered them.
    expect(offered.some((text) => text?.startsWith("SCEN"))).toBe(true);
    expect(offered.some((text) => text?.startsWith("CPSC"))).toBe(false);
    fireEvent.click(screen.getAllByRole("option").find((option) => option.textContent?.startsWith("SCEN")) as HTMLElement);

    await waitFor(() => expect(save).toHaveBeenCalledWith("PHYS", ["PHYS", "SCEN"]));
  });

  it("puts one course in a programme by hand", async () => {
    const put = vi.spyOn(programs, "putCourseProgramme").mockResolvedValue(SCEN);
    show(true);

    fireEvent.click(await screen.findByRole("combobox", { name: "Programme of SCEN-102" }));
    fireEvent.click(screen.getByRole("option", { name: "Mathematics" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("SCEN-102", "MATH"));
  });

  it("is read-only for somebody who is not an administrator", async () => {
    show(false);

    const maths = await card("MATH");
    expect(within(maths).getByText("CPSC")).toBeTruthy();
    expect(within(maths).getByText("Not given yet")).toBeTruthy();
    expect(within(maths).queryByLabelText("Another code for MATH")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Programme of PHYS-125" })).toBeNull();
    expect(screen.getByText("Only an administrator can change the programmes.")).toBeTruthy();
  });

  it("says where programmes come from when the department has none yet", async () => {
    show(true, { programmes: [], courses: {} });

    expect(await screen.findByText(/No programme yet/)).toBeTruthy();
  });

  it("is what a link to either of the old pages opens", () => {
    expect(sectionFrom("#/settings/programme-codes", false)).toBe("programmes");
    expect(sectionFrom("#/settings/course-programs", true)).toBe("programmes");
  });
});
