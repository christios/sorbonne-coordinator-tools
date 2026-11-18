import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import * as auth from "@/services/auth";
import type { CoursePlan, CoursePlanSemester } from "@/services/coursePlans";
import type { WishCollection, Wishes } from "@/services/teacherWishes";
import * as invite from "@/services/wishInvite";

const COLLECTION: WishCollection = {
  termCode: "262720", deadline: "2099-01-10", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
};
const COURSE: CoursePlan = {
  courseCode: "MATH-002",
  title: "Elements of Calculus",
  coefficient: "",
  active: true,
  components: { CM: { hours: 6, length: 1.5 }, TD: { hours: 3, length: 1.5 }, TP: { hours: null, length: null } },
  hoursUpdatedAt: "2026-11-18T09:00:00Z",
  hoursUpdatedBy: "",
  leadId: "valerie",
  leadName: "Valerie Le Guyon",
  leadSetAt: "",
  leadSetBy: "",
  weeks: {},
  note: "",
  answeredAt: "",
  answeredBy: "",
  answerSource: "",
};
const STEP: CoursePlanSemester = {
  termCode: "262720",
  weeks: [1, 2, 3, 4].map((week) => ({
    week,
    monday: `2027-01-${String(4 + week * 7).padStart(2, "0")}`,
    holidays: week === 3 ? [{ date: "2027-01-26", label: "Founders' day" }] : [],
  })),
  courses: [COURSE],
};
const FORM: invite.InviteeForm = {
  semesterName: "Semester 2 2026-27",
  teacherName: "Valerie Le Guyon",
  email: "valerie@gmail.com",
  collection: COLLECTION,
  wishes: null,
  window: { open: true, deadline: "2099-01-10", reopenedUntil: "" },
  previous: null,
  reductions: null,
  coursePlans: STEP,
};
const SUBMITTED: Wishes = {
  status: "submitted", blocks: [], limits: {}, limitKinds: {}, comments: {}, needs: "", note: "", lines: [],
  overCapReason: "", source: "invitation", submittedAt: "2026-11-18T10:00:00Z", updatedAt: "2026-11-18T10:00:00Z", updatedBy: "",
};

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InvitedWishesPage code="the-code" />
    </QueryClientProvider>,
  );

const total = (component: string) => document.querySelector(`[data-total="${component}"]`)?.textContent ?? "";

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
  vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "client.apps.googleusercontent.com" });
  vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
    semesterName: "Semester 2 2026-27", teacherName: "Valerie Le Guyon", email: "v***@gmail.com",
    deadline: "", message: "", signedIn: true,
  });
});

describe("a course lead's step: their courses, week by week", () => {
  it("comes before the preferences, adds up against the locked hours, and goes on once saved", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue(FORM);
    const laid = { ...COURSE, answeredAt: "2026-11-18T11:00:00Z", answerSource: "lead" as const, weeks: { CM: { "1": 1, "2": 1, "3": 1, "4": 1 } } };
    const save = vi.spyOn(invite, "saveInviteeCoursePlans").mockResolvedValue({ ...FORM, coursePlans: { ...STEP, courses: [laid] } });
    page();

    expect(await screen.findByRole("heading", { name: /Your course, week by week in Semester 2 2026-27/ })).toBeTruthy();
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(within(steps).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "1Course schedule",
      "2Preferences and constraints",
    ]);
    expect(screen.queryByRole("heading", { name: "Your week" })).toBeNull();
    // A row for each component the coordinators gave hours to, none for TP; the targets are not inputs.
    const grid = screen.getByRole("table", { name: "MATH-002 sessions week by week" });
    expect(within(grid).queryByText("TP")).toBeNull();
    expect(within(grid).queryByRole("textbox", { name: /hours/ })).toBeNull();
    expect(total("CM")).toBe("0 of 6 h");
    // The week a holiday falls in says so.
    expect(within(grid).getByLabelText("A holiday falls in this week")).toBeTruthy();

    // Spread evenly: 6 h of 1.5 h sessions over four weeks is one a week.
    fireEvent.click(within(grid).getAllByRole("button", { name: "Spread evenly" })[0]);
    expect(total("CM")).toBe("6 of 6 h");
    // Typed by hand, and with the arrow keys.
    fireEvent.change(within(grid).getByRole("textbox", { name: "TD sessions in week 2" }), { target: { value: "1" } });
    expect(total("TD")).toBe("1.5 of 3 h");
    fireEvent.keyDown(within(grid).getByRole("textbox", { name: "TD sessions in week 3" }), { key: "ArrowUp" });
    expect(total("TD")).toBe("3 of 3 h");
    fireEvent.keyDown(within(grid).getByRole("textbox", { name: "TD sessions in week 3" }), { key: "ArrowDown" });
    expect(total("TD")).toBe("1.5 of 3 h");
    fireEvent.change(screen.getByRole("textbox", { name: "Note about MATH-002" }), { target: { value: "TD needs 4.5 h" } });

    fireEvent.click(screen.getByRole("button", { name: "Save and go on to your preferences" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("the-code", [
        { courseCode: "MATH-002", weeks: { CM: { "1": 1, "2": 1, "3": 1, "4": 1 }, TD: { "2": 1 } }, note: "TD needs 4.5 h" },
      ]),
    );
    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
  });

  it("can be skipped for now, and nobody but a course lead has it", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue(FORM);
    const save = vi.spyOn(invite, "saveInviteeCoursePlans");
    const { unmount } = page();
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    unmount();

    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, coursePlans: null });
    page();
    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Steps" })).toBeNull();
  });

  it("is said to be left to do when the preferences are submitted and the courses are not laid out", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, wishes: SUBMITTED });
    page();

    expect(await screen.findByText(/One thing is left: lay out the course you lead week by week/)).toBeTruthy();
    expect(screen.queryByText(/nothing more to do/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lay out my course" }));
    expect(await screen.findByRole("table", { name: "MATH-002 sessions week by week" })).toBeTruthy();
  });

  it("shows the courses as laid out beside the answer sent", async () => {
    const laid = { ...COURSE, answeredAt: "2026-11-18T11:00:00Z", answerSource: "lead" as const, note: "Fine", weeks: { CM: { "1": 1, "2": 1, "3": 1, "4": 1 }, TD: { "2": 1 } } };
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, wishes: SUBMITTED, coursePlans: { ...STEP, courses: [laid] } });
    page();

    expect(await screen.findByText("Your answer is submitted: nothing more to do.")).toBeTruthy();
    const summary = screen.getByRole("heading", { name: "Your course, week by week" }).closest("section") as HTMLElement;
    expect(within(summary).getByText("6 of 6 h")).toBeTruthy();
    expect(within(summary).getByText("1.5 of 3 h")).toBeTruthy();
    expect(within(summary).getByText(/Weeks 1–4/)).toBeTruthy();
  });
});
