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
    // A box holds sessions, not hours: what it makes is said under it.
    expect(within(grid).getByRole("textbox", { name: "TD sessions in week 3" }).closest("td")?.textContent).toBe("1.5 h");
    fireEvent.keyDown(within(grid).getByRole("textbox", { name: "TD sessions in week 3" }), { key: "ArrowDown" });
    expect(total("TD")).toBe("1.5 of 3 h");
    fireEvent.change(screen.getByRole("textbox", { name: "Note about MATH-002" }), { target: { value: "TD needs 4.5 h" } });

    fireEvent.click(screen.getByRole("button", { name: "Save and go on to your preferences" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("the-code", [
        {
          courseCode: "MATH-002",
          weeks: { CM: { "1": 1, "2": 1, "3": 1, "4": 1 }, TD: { "2": 1 } },
          lengths: {},
          note: "TD needs 4.5 h",
        },
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

  it("shows the courses as laid out, in the summary of the whole request", async () => {
    const laid = {
      ...COURSE,
      answeredAt: "2026-11-18T11:00:00Z",
      answerSource: "lead" as const,
      note: "Fine",
      weeks: { CM: { "1": 1, "2": 1, "4": 1 }, TD: { "2": 1 } },
      lengths: { CM: { "4": [3] } },
    };
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, wishes: SUBMITTED, coursePlans: { ...STEP, courses: [laid] } });
    page();

    expect(await screen.findByText("Your answer is submitted: nothing more to do.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Summary of your requests for Semester 2 2026-27" })).toBeTruthy();
    // A card per part, numbered as its step was: the course schedule, then the preferences.
    const card = screen.getByRole("region", { name: "Course schedule" });
    expect(within(card).getByText("1 of 1 laid out")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Change course schedule" })).toBeTruthy();
    // 1.5 + 1.5 + a 3 h week: 6 of 6 h; the week of its own length said under the strip.
    expect(within(card).getByText("6 of 6 h")).toBeTruthy();
    expect(within(card).getByText("1.5 of 3 h")).toBeTruthy();
    // The week of its own length: one session, in amber, its 3 h under it.
    expect(within(card).getByRole("img", { name: "Week 4: 1 CM session of 3 h" }).textContent).toBe("13 h");
    expect(within(card).getByRole("img", { name: "Week 3: no CM session" })).toBeTruthy();
    expect(within(card).getByRole("group", { name: "CM: Weeks 1–2, 4, 3 h in week 4" })).toBeTruthy();
    expect(within(card).getByText("Fine")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Preferences and constraints" })).toBeTruthy();
  });

  it("lets a week's sessions last longer than usual, counted in the total", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue(FORM);
    const save = vi.spyOn(invite, "saveInviteeCoursePlans").mockResolvedValue(FORM);
    page();

    const grid = await screen.findByRole("table", { name: "MATH-002 sessions week by week" });
    fireEvent.change(within(grid).getByRole("textbox", { name: "CM sessions in week 1" }), { target: { value: "1" } });
    fireEvent.change(within(grid).getByRole("textbox", { name: "CM sessions in week 2" }), { target: { value: "1" } });
    expect(total("CM")).toBe("3 of 6 h");

    // The hours under week 2's box: its session is a three-hour exam.
    fireEvent.click(within(grid).getByRole("button", { name: "Length of the CM session in week 2: 1.5 h" }));
    const length = await screen.findByRole("textbox", { name: "Hours the CM session lasts in week 2" });
    fireEvent.change(length, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(total("CM")).toBe("4.5 of 6 h");
    expect(within(grid).getByRole("button", { name: "Length of the CM session in week 2: 3 h" })).toBeTruthy();

    // Back to the usual length, and on again to 3 h; emptied, the week keeps no length of its own.
    fireEvent.click(within(grid).getByRole("button", { name: "Length of the CM session in week 2: 3 h" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to 1.5 h" }));
    expect(total("CM")).toBe("3 of 6 h");
    fireEvent.click(within(grid).getByRole("button", { name: "Length of the CM session in week 2: 1.5 h" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Hours the CM session lasts in week 2" }), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("alert").textContent).toMatch(/between 0 and 8 hours/);
    fireEvent.change(screen.getByRole("textbox", { name: "Hours the CM session lasts in week 2" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Save and go on to your preferences" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("the-code", [
        { courseCode: "MATH-002", weeks: { CM: { "1": 1, "2": 1 } }, lengths: { CM: { "2": [3] } }, note: "" },
      ]),
    );
  });

  it("lets two sessions of one week last differently: a usual one and an exam", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue(FORM);
    const save = vi.spyOn(invite, "saveInviteeCoursePlans").mockResolvedValue(FORM);
    page();

    const grid = await screen.findByRole("table", { name: "MATH-002 sessions week by week" });
    fireEvent.change(within(grid).getByRole("textbox", { name: "CM sessions in week 3" }), { target: { value: "2" } });
    expect(total("CM")).toBe("3 of 6 h");
    fireEvent.click(within(grid).getByRole("button", { name: "Length of the CM sessions in week 3: 1.5 h" }));
    // A length for each of the week's sessions.
    expect(await screen.findByRole("textbox", { name: "Hours CM session 1 lasts in week 3" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Hours CM session 2 lasts in week 3" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(total("CM")).toBe("4.5 of 6 h");
    expect(within(grid).getByRole("button", { name: "Length of the CM sessions in week 3: 1.5 h + 3 h" })).toBeTruthy();

    // A third session that week lasts the usual length; taken away again, the exam stays.
    fireEvent.keyDown(within(grid).getByRole("textbox", { name: "CM sessions in week 3" }), { key: "ArrowUp" });
    expect(total("CM")).toBe("6 of 6 h");
    fireEvent.keyDown(within(grid).getByRole("textbox", { name: "CM sessions in week 3" }), { key: "ArrowDown" });
    expect(total("CM")).toBe("4.5 of 6 h");

    fireEvent.click(screen.getByRole("button", { name: "Save and go on to your preferences" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("the-code", [
        { courseCode: "MATH-002", weeks: { CM: { "3": 2 } }, lengths: { CM: { "3": [1.5, 3] } }, note: "" },
      ]),
    );
  });
});
