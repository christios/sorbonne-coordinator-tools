import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SemesterList } from "@/components/SemesterList";
import * as lists from "@/services/portalLists";
import * as plans from "@/services/semesterPlans";
import * as termWeeks from "@/services/termWeeks";
import type { Plan, PlanSummary } from "@/services/semesterPlans";
import * as timetables from "@/services/timetables";

const TERM: timetables.TimetableTerm = {
  id: "term-1",
  name: "Physics & Maths — Semester 1",
  slug: "physics-maths-semester-1",
  timezone: "Asia/Dubai",
  isPublished: false,
  courseCount: 43,
  sessionCount: 975,
  studentCount: 180,
  timetableFilename: "PHYS-MATHS-FY-SEM.1-Revised.xls",
  enrolmentFilename: "students.xlsx",
  updatedAt: "2026-08-21T18:00:00Z",
};

function renderList(props: Partial<Parameters<typeof SemesterList>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SemesterList host="scen.example.dev" {...props} />
    </QueryClientProvider>,
  );
}

const SPRING: PlanSummary = {
  termCode: "262720",
  semesterId: "plan:262720",
  name: "Semester 2 2026-27",
  weekOne: "2027-01-11",
  weeks: 15,
  sections: 40,
  series: 12,
};

beforeEach(() => {
  vi.spyOn(timetables, "fetchHubTerms").mockResolvedValue([TERM]);
  vi.spyOn(plans, "fetchPlans").mockResolvedValue([]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
  vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({});
});

afterEach(() => vi.restoreAllMocks());

/* The Student Hub's own controls are hidden for now; these keep them working for when they return. */
describe("the semesters the platform holds", () => {
  it("lists them with what each one contains", async () => {
    renderList({ hubControls: true });

    const row = await screen.findByRole("row", { name: /Physics & Maths/ });
    expect(within(row).getByText("43 courses · 975 sessions · 180 students")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Hidden" })).toBeTruthy();
  });

  it("uses the shared select control, not a native one", async () => {
    // docs/handoffs/ui-ux-decisions.md: no native <select> in product UI.
    renderList();
    await screen.findByRole("row", { name: /Physics & Maths/ });

    expect(document.querySelector("select")).toBeNull();
  });

  it("publishes a hidden semester", async () => {
    const publish = vi
      .spyOn(timetables, "setTimetableTermPublished")
      .mockResolvedValue({ ...TERM, isPublished: true });
    renderList({ hubControls: true });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith("term-1", true));
  });

  it("asks for confirmation before deleting a semester", async () => {
    const remove = vi.spyOn(timetables, "deleteTimetableTerm").mockResolvedValue();
    renderList({ hubControls: true });

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/975 sessions will be removed/)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete semester" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("term-1"));
  });

  it("leaves the semester alone when the confirmation is dismissed", async () => {
    const remove = vi.spyOn(timetables, "deleteTimetableTerm").mockResolvedValue();
    renderList({ hubControls: true });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });
});


/*
 * Uploading a timetable is retired: the hours a clash is worked out from come from the
 * registrar's own timetable now, swept section by section as the last step of Portal sync.
 *
 * The tests that drove the two upload flows through this page went with the buttons. The
 * components themselves are untouched and `SemesterImport.test.tsx` still exercises one
 * directly, so bringing the feature back is uncommenting two buttons — not rebuilding it.
 */
describe("uploading a timetable, retired", () => {
  it("offers neither way in, and says why", async () => {
    renderList({ hubControls: true });

    expect(await screen.findByText(/Uploading a timetable is retired/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Import a timetable/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Update timetable/ })).toBeNull();
  });

  it("still lists what was uploaded before, so nothing is lost", async () => {
    renderList({ hubControls: true });

    expect(await screen.findByText("Physics & Maths — Semester 1")).toBeTruthy();
    expect(screen.getByText("PHYS-MATHS-FY-SEM.1-Revised.xls")).toBeTruthy();
  });
});

/*
 * Which screen of this page is open is the address's business, not this component's, so
 * that a reload, a link, and a step to another page and back all return to the same place.
 */
describe("the week of one semester", () => {
  it("opens it on the Timetable page, which is a page of its own now", async () => {
    const onOpenWeek = vi.fn();
    renderList({ onOpenWeek });
    await screen.findByRole("row", { name: /Physics & Maths/ });

    fireEvent.click(screen.getByRole("button", { name: "Timetable" }));

    expect(onOpenWeek).toHaveBeenCalledWith("term-1");
  });
});

/*
 * Semesters are made and managed on this page: the Semester plan and the other pages pick one.
 */
describe("the semesters made here", () => {
  it("lists them beside the Hub's, in the portal's order, with their weeks", async () => {
    vi.spyOn(plans, "fetchPlans").mockResolvedValue([SPRING]);
    // A Hub semester no portal term was given goes last.
    vi.spyOn(timetables, "fetchHubTerms").mockResolvedValue([{ ...TERM, id: "term-0", name: "A stray upload" }, TERM]);
    renderList();

    const spring = await screen.findByRole("row", { name: /Semester 2 2026-27/ });
    const names = screen.getAllByRole("row").slice(1).map((row) => row.querySelector("td span span")?.textContent);
    expect(names).toEqual(["Physics & Maths — Semester 1", "Semester 2 2026-27", "A stray upload"]);
    expect(within(spring).getByText("15 teaching weeks from 11 Jan 2027")).toBeTruthy();
    expect(within(spring).getByText("262720")).toBeTruthy();
    expect(within(spring).queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("makes a new one under its portal code, with its short name", async () => {
    const create = vi.spyOn(plans, "createPlan").mockResolvedValue({ ...SPRING, termCode: "262730", semesterId: "plan:262730" } as unknown as Plan);
    const short = vi.spyOn(lists, "setSemesterShortName").mockResolvedValue({ termId: "plan:262730", shortName: "S3" });
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: /New semester/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "New semester" }));
    fireEvent.change(dialog.getByLabelText(/Portal term code/), { target: { value: "262730" } });
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Summer 2026-27" } });
    fireEvent.change(dialog.getByLabelText("Short name"), { target: { value: "S3" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create semester" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("262730", "Summer 2026-27"));
    await waitFor(() => expect(short).toHaveBeenCalledWith("plan:262730", "S3"));
  });

  it("will not make a second semester for a portal term that has one", async () => {
    const create = vi.spyOn(plans, "createPlan");
    renderList();
    await screen.findByRole("row", { name: /Physics & Maths/ });

    fireEvent.click(screen.getByRole("button", { name: /New semester/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "New semester" }));
    fireEvent.change(dialog.getByLabelText(/Portal term code/), { target: { value: "262710" } });
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Semester 1 again" } });

    expect(dialog.getByRole("alert").textContent).toBe("Physics & Maths — Semester 1 is 262710 already.");
    expect((dialog.getByRole("button", { name: "Create semester" }) as HTMLButtonElement).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("opens its settings — name, short name, weeks and holidays — from its row", async () => {
    vi.spyOn(plans, "fetchPlans").mockResolvedValue([SPRING]);
    vi.spyOn(plans, "fetchPlan").mockResolvedValue({ ...SPRING, without: [], holidays: [] } as unknown as Plan);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Settings of Semester 2 2026-27" }));

    expect(await screen.findByRole("dialog", { name: "Semester settings" })).toBeTruthy();
    expect((screen.getByLabelText(/^Teaching weeks/) as HTMLInputElement).value).toBe("15");
  });

  it("is deleted once confirmed, and opens on the Semester plan", async () => {
    vi.spyOn(plans, "fetchPlans").mockResolvedValue([SPRING]);
    const remove = vi.spyOn(plans, "deletePlan").mockResolvedValue();
    const onOpenPlan = vi.fn();
    renderList({ onOpenPlan });

    const spring = await screen.findByRole("row", { name: /Semester 2 2026-27/ });
    fireEvent.click(within(spring).getByRole("button", { name: "Plan" }));
    expect(onOpenPlan).toHaveBeenCalledWith("262720");

    fireEvent.click(within(spring).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/the 12 classes placed on its plan will be deleted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete semester" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("262720"));
  });
});

describe("the Student Hub, hidden for now", () => {
  it("shows a Hub semester as a semester, with none of what is done on the Hub", async () => {
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: [] } });
    renderList();

    const row = await screen.findByRole("row", { name: /Physics & Maths/ });
    expect(within(row).getByText("Week 1 from 31 Aug 2026")).toBeTruthy();
    // Its portal term is said, not typed: its sets and students are filed by it.
    expect(within(row).getByText("262710")).toBeTruthy();
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(within(row).getByRole("button", { name: "Settings of Physics & Maths — Semester 1" })).toBeTruthy();
    for (const name of ["Hidden", "Publish", "Delete", /Rename/]) expect(within(row).queryByRole("button", { name })).toBeNull();
    expect(screen.queryByText(/Uploading a timetable is retired/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Student Hub" })).toBeNull();
  });
});

describe("a semester's settings", () => {
  it("keep a Hub semester's short name, teaching weeks and pay periods", async () => {
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Settings of Physics & Maths — Semester 1" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Semester settings" }));
    expect(dialog.getByRole("textbox", { name: "Short name" })).toBeTruthy();
    expect(dialog.getByText("Teaching weeks")).toBeTruthy();
    expect(dialog.getByText("Pay periods")).toBeTruthy();
  });

  it("keep a semester made here's short name and pay periods beside its weeks and holidays", async () => {
    vi.spyOn(plans, "fetchPlans").mockResolvedValue([SPRING]);
    vi.spyOn(plans, "fetchPlan").mockResolvedValue({ ...SPRING, without: [], holidays: [] } as unknown as Plan);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Settings of Semester 2 2026-27" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Semester settings" }));
    expect(dialog.getByRole("textbox", { name: "Short name" })).toBeTruthy();
    expect(dialog.getByText("Holidays")).toBeTruthy();
    expect(dialog.getByText("Pay periods")).toBeTruthy();
    // Neither is a column of the list any more.
    expect(screen.queryByRole("columnheader", { name: /Short name|Pay periods/ })).toBeNull();
  });
});
