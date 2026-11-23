import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePlanDialog, CoursePlanEditor } from "@/components/CoursePlanDialog";
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

describe("a course's plan on Active courses, read only (23 Nov 2026)", () => {
  it("reads the hours from Groups & CRNs, says what stands in the way, and points there to change them", () => {
    dialog({
      ...EMPTY,
      leadId: "valerie",
      leadName: "Valerie Le Guyon",
      components: {
        CM: { hours: 24, length: 1.5, issue: "" },
        TD: { hours: 21, length: null, issue: "No session length in Groups & CRNs yet" },
        TP: { hours: null, length: null, issue: "Groups & CRNs says 7.5 h and 12 h: the groups must agree" },
      },
    });

    expect(screen.getByText(/Set on/).textContent).toContain("Groups & CRNs");
    const hours = screen.getByRole("region", { name: "Hours" });
    expect(within(hours).getByText("24 h")).toBeTruthy();
    expect(within(hours).getByText("No session length in Groups & CRNs yet")).toBeTruthy();
    expect(within(hours).getByText("Groups & CRNs says 7.5 h and 12 h: the groups must agree")).toBeTruthy();
    // Nothing to type into, no lead to pick, no weeks to fill in here.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Fill in for the lead|Save/ })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Course lead" })).getByText("Valerie Le Guyon")).toBeTruthy();
    // The TD, with no session length, can't be laid out, and says why.
    expect(screen.getByText(/No session length in Groups & CRNs yet, so its weeks can.t be laid out/)).toBeTruthy();
  });
});

const editor = (plan: CoursePlan) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CoursePlanEditor term="262720" plan={plan} weeks={WEEKS} semesterName="Semester 2 2026-27" />
    </QueryClientProvider>,
  );

describe("a course's plan, set from its record opened in Groups & CRNs (23 Nov 2026)", () => {
  const PLANNED: CoursePlan = {
    ...EMPTY,
    components: { CM: { hours: 3, length: 1.5, issue: "" }, TD: { hours: 3, length: 1.5, issue: "" }, TP: { hours: null, length: null } },
    weeks: { CM: { "1": 1, "2": 1 } },
  };

  it("picks the course's lead", async () => {
    const change = vi.spyOn(plans, "changeCoursePlan").mockResolvedValue({ ...PLANNED, leadId: "valerie", leadName: "Valerie Le Guyon" });
    editor(PLANNED);

    fireEvent.click(screen.getByRole("combobox", { name: "Lead of MATH-002" }));
    fireEvent.click(await screen.findByRole("option", { name: "Valerie Le Guyon" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith("262720", "MATH-002", { leadId: "valerie" }));
  });

  it("fills the weeks in for the lead", async () => {
    const lay = vi.spyOn(plans, "layOutCourse").mockResolvedValue(PLANNED);
    editor(PLANNED);

    expect(screen.getByText("Hours, from Groups & CRNs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fill in for the lead" }));
    const grid = screen.getByRole("table", { name: "MATH-002 sessions week by week" });
    fireEvent.change(within(grid).getByRole("textbox", { name: "TD sessions in week 1" }), { target: { value: "1" } });
    fireEvent.change(within(grid).getByRole("textbox", { name: "TD sessions in week 3" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the weeks" }));

    await waitFor(() =>
      expect(lay).toHaveBeenCalledWith(
        "262720",
        "MATH-002",
        expect.objectContaining({ weeks: { CM: { "1": 1, "2": 1 }, TD: { "1": 1, "3": 1 } }, lengths: {} }),
      ),
    );
  });

  it("can't lay out a component with no session length, and says it is missing", () => {
    editor({ ...PLANNED, components: { ...PLANNED.components, TD: { hours: 3, length: null, issue: "No session length in Groups & CRNs yet" } } });

    expect(screen.getAllByText(/No session length in Groups & CRNs yet/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Fill in for the lead" }));
    expect(screen.queryByRole("textbox", { name: /TD sessions/ })).toBeNull();
  });
});
