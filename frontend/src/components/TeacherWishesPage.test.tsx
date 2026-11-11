import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherWishesPage } from "@/components/TeacherWishesPage";
import * as wishes from "@/services/teacherWishes";

vi.mock("@/components/PortalSemesterMenu", () => ({
  usePortalSemester: () => ({ semesters: [], semester: { id: "s2", name: "Semester 2" }, setTermId: () => {}, term: "262720", settled: true }),
  PortalSemesterMenu: () => null,
}));

const SEMESTER: wishes.WishSemester = {
  collection: {
    termCode: "262720", deadline: "2026-12-10", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
    mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
  },
  teachers: [
    {
      teacherId: "t-valerie",
      name: "Valerie Le Guyon",
      email: "",
      wishes: {
        status: "submitted", blocks: [{ id: "run", kind: "constraint", days: [2], from: 14, to: 16, repeat: "all", week: "", comment: "School run" }],
        limits: { maxDays: 3 }, limitKinds: {}, needs: "", note: "Mornings are best", comments: {},
        lines: [], overCapReason: "", source: "teacher", submittedAt: "2026-11-09T10:00:00Z", updatedAt: "2026-11-09T10:00:00Z", updatedBy: "",
      },
    },
    { teacherId: "t-jad", name: "Jad Tarsissi", email: "", wishes: null },
  ],
};

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TeacherWishesPage />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.spyOn(wishes, "fetchWishSemester").mockResolvedValue(SEMESTER);
});


// The guided tour is taken once in a browser before the form is used: here it has been.
beforeEach(() => {
  window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
});

describe("a teacher's answer, opened from the list", () => {
  it("is read first, and changed only through Edit their answer, with a warning", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Open Valerie Le Guyon's preferences" }));
    expect(screen.getByText(/Submitted by Valerie Le Guyon/)).toBeTruthy();
    expect(screen.getByText("“School run”")).toBeTruthy();
    expect(screen.getByText("At most 3 days on campus")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit their answer" }));
    expect(screen.getByRole("note").textContent).toMatch(/You’re changing Valerie Le Guyon’s answer/);
    // The form opens on the calendar: Save draft on every page, Submit on the last.
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next: Limits/ })).toBeTruthy();
  });

  it("is answered on the teacher's behalf when they have not, and says so", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Fill in Jad Tarsissi's preferences" }));
    expect(screen.getByRole("dialog", { name: "Answer for Jad Tarsissi" })).toBeTruthy();
    expect(screen.getByText(/on .*behalf/)).toBeTruthy();
  });
});

describe("closing the wishes window", () => {
  it("closes at once when nothing has changed, from a click beside it", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Fill in Jad Tarsissi's preferences" }));
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Answer for Jad Tarsissi" }).parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Answer for Jad Tarsissi" })).toBeNull());
  });

  it("asks first when something has, and keeps editing or lets it go", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Fill in Jad Tarsissi's preferences" }));
    fireEvent.click(screen.getByRole("button", { name: /^Monday \d+ \w+ 09:00: fine/ }));
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Answer for Jad Tarsissi" }).parentElement as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard your changes?" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Monday \d+ \w+ 09:00: constraint, every week/ })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog", { name: "Answer for Jad Tarsissi" })).toBeNull();
  });
});

describe("invitations and the deadline, on the list", () => {
  it("says how far an invitation got, and offers a new link, withdrawing it, and reopening after the deadline", async () => {
    const reopen = vi.spyOn(wishes, "reopenFor").mockResolvedValue({ open: true, deadline: "2020-01-10", reopenedUntil: "2099-01-01" });
    vi.spyOn(wishes, "fetchWishSemester").mockResolvedValue({
      ...SEMESTER,
      collection: { ...SEMESTER.collection!, deadline: "2020-01-10" },
      teachers: SEMESTER.teachers.map((row) =>
        row.teacherId === "t-jad"
          ? {
              ...row,
              invitation: { email: "jad@gmail.com", createdAt: "2026-11-10T09:00:00Z", createdBy: "", openedAt: "2026-11-10T10:00:00Z", signedInAt: "" },
            }
          : row,
      ),
    });
    page();
    expect(await screen.findByText(/^Opened /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make a new invitation for Jad Tarsissi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw Jad Tarsissi's invitation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite Valerie Le Guyon" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reopen Jad Tarsissi's answer" }));
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(reopen).toHaveBeenCalledWith("262720", "t-jad", "2099-01-01"));
  });
});
