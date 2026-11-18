import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePlanDialog } from "@/components/CoursePlanDialog";
import * as plans from "@/services/coursePlans";
import type { CoursePlan, TeachingWeek } from "@/services/coursePlans";
import * as portal from "@/services/portalLists";
import type { ActiveTeacher } from "@/services/portalLists";

const EMPTY: CoursePlan = {
  courseCode: "MATH-002",
  title: "Elements of Calculus",
  coefficient: "4",
  active: true,
  components: { CM: { hours: null, length: null }, TD: { hours: null, length: null }, TP: { hours: null, length: null } },
  hoursUpdatedAt: "",
  hoursUpdatedBy: "",
  leadId: "",
  leadName: "",
  leadSetAt: "",
  leadSetBy: "",
  weeks: {},
  note: "",
  answeredAt: "",
  answeredBy: "",
  answerSource: "",
};
const WEEKS: TeachingWeek[] = [1, 2, 3].map((week) => ({ week, monday: "", holidays: [] }));
const teacher = (id: string, fullName: string) => ({ id, fullName, email: "" }) as ActiveTeacher;

const dialog = (plan: CoursePlan) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CoursePlanDialog term="262720" semesterName="Semester 2 2026-27" plan={plan} weeks={WEEKS} onClose={vi.fn()} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(portal, "fetchActiveTeachers").mockResolvedValue([teacher("samar", "Samar Ghantous"), teacher("valerie", "Valerie Le Guyon")]);
});

describe("a course's plan, for coordinators", () => {
  it("sets the hours with a session length each, and asks for the lead by hand", async () => {
    const set = { ...EMPTY, components: { ...EMPTY.components, CM: { hours: 24, length: 1.5 } }, hoursUpdatedAt: "2026-11-18T09:00:00Z" };
    const change = vi
      .spyOn(plans, "changeCoursePlan")
      .mockResolvedValueOnce(set)
      .mockResolvedValueOnce({ ...set, leadId: "valerie", leadName: "Valerie Le Guyon", leadSetAt: "2026-11-18T09:05:00Z" });
    dialog(EMPTY);

    // Nobody is suggested, not even who teaches the lecture: the lead starts as nobody.
    expect(screen.getByRole("combobox", { name: "Lead of MATH-002" }).textContent).toMatch(/Nobody yet/);
    expect(screen.getByText(/Set the course’s hours first/)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "CM hours" }), { target: { value: "24" } });
    fireEvent.change(screen.getByRole("textbox", { name: "CM session length in hours" }), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith("262720", "MATH-002", {
        hours: { CM: { hours: "24", length: "1.5" }, TD: { hours: null, length: null }, TP: { hours: null, length: null } },
      }),
    );
    // With hours, the weeks can be laid out: here by a coordinator, for the lead.
    expect(await screen.findByRole("button", { name: "Fill in for the lead" })).toBeTruthy();
    expect(screen.getByText("No lead picked yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Lead of MATH-002" }));
    fireEvent.click(await screen.findByRole("option", { name: "Valerie Le Guyon" }));
    await waitFor(() => expect(change).toHaveBeenLastCalledWith("262720", "MATH-002", { leadId: "valerie" }));
    expect(await screen.findByText("Waiting for Valerie Le Guyon to lay it out")).toBeTruthy();
  });

  it("fills the weeks in for the lead, kept as entered by the coordinator", async () => {
    const plan = {
      ...EMPTY,
      components: { ...EMPTY.components, TD: { hours: 3, length: 1.5 } },
      leadId: "valerie",
      leadName: "Valerie Le Guyon",
    };
    const layOut = vi.spyOn(plans, "layOutCourse").mockResolvedValue({
      ...plan,
      weeks: { TD: { "1": 1, "2": 1 } },
      answeredAt: "2026-11-18T10:00:00Z",
      answeredBy: "Christian",
      answerSource: "coordinator",
    });
    dialog(plan);

    fireEvent.click(screen.getByRole("button", { name: "Fill in for the lead" }));
    expect(screen.getByText(/You’re laying out MATH-002 for Valerie Le Guyon/)).toBeTruthy();
    const grid = screen.getByRole("table", { name: "MATH-002 sessions week by week" });
    fireEvent.click(within(grid).getByRole("button", { name: "Spread evenly" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the weeks" }));

    await waitFor(() => expect(layOut).toHaveBeenCalledWith("262720", "MATH-002", { weeks: { TD: { "2": 1, "3": 1 } }, note: "" }));
    expect(await screen.findByText(/Laid out by Christian for the lead/)).toBeTruthy();
  });
});
