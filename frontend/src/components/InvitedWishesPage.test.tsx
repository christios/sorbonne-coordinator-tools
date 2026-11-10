import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import * as auth from "@/services/auth";
import type { WishCollection, Wishes } from "@/services/teacherWishes";
import * as invite from "@/services/wishInvite";

const COLLECTION: WishCollection = {
  termCode: "262720", deadline: "2099-01-10", message: "Tell us by January.", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
};
const ANSWER: Wishes = {
  status: "submitted", cells: Array.from({ length: 8 }, (_, quarter) => ({ day: 2, hour: 14 + quarter / 4, kind: "cant" as const })),
  limits: {}, away: [], needs: "", note: "Mornings, please", levels: { "cant:14-16:2": "must" }, comments: {}, lines: [],
  overCapReason: "", source: "invitation", submittedAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z", updatedBy: "",
};
const FORM: invite.InviteeForm = {
  semesterName: "Semester 2 2026-27",
  teacherName: "Joumana El Rifai",
  email: "joumana.rifai@gmail.com",
  collection: COLLECTION,
  wishes: null,
  window: { open: true, deadline: "2099-01-10", reopenedUntil: "" },
  previous: { termCode: "262710", semesterName: "Semester 1 2026-27", wishes: { ...ANSWER, away: [] } },
};

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InvitedWishesPage code="the-code" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "client.apps.googleusercontent.com" });
});

describe("an invited teacher's link", () => {
  it("says it no longer works when it does not", async () => {
    vi.spyOn(invite, "fetchInvitation").mockRejectedValue(new invite.InviteRefused("This invitation link is not valid any more.", 401));
    page();
    expect(await screen.findByText("This link no longer works")).toBeTruthy();
  });

  it("says what it is for and which Google account to sign in with, before anything of the answer", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "Semester 2 2026-27", teacherName: "Joumana El Rifai", email: "j************@gmail.com",
      deadline: "2099-01-10", message: "Tell us by January.", signedIn: false,
    });
    const form = vi.spyOn(invite, "fetchInviteeForm");
    page();
    expect(await screen.findByText("Hello Joumana El Rifai,")).toBeTruthy();
    expect(screen.getByText("j************@gmail.com")).toBeTruthy();
    expect(screen.getByText("Tell us by January.")).toBeTruthy();
    expect(screen.getByTestId("google-sign-in")).toBeTruthy();
    expect(form).not.toHaveBeenCalled();
  });

  it("offers last semester's answer to start from, and saves the teacher's own", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "Semester 2 2026-27", teacherName: "Joumana El Rifai", email: "j***@gmail.com", deadline: "", message: "", signedIn: true,
    });
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue(FORM);
    const save = vi.spyOn(invite, "saveInviteeAnswer").mockResolvedValue({ ...FORM, wishes: ANSWER });
    page();
    expect(await screen.findByText(/You answered for Semester 1 2026-27 before/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your week" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start from it" }));
    expect(screen.getByRole("button", { name: /^Tuesday 14:00: can't teach, a Must/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("the-code", expect.objectContaining({ submit: true, note: "Mornings, please" })));
    expect(await screen.findByText(/Thank you: your preferences and constraints are submitted/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change my answer" })).toBeTruthy();
  });

  it("shows the answer to read, and no way to change it, after the deadline", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "", teacherName: "Joumana El Rifai", email: "j***@gmail.com", deadline: "2020-01-10", message: "", signedIn: true,
    });
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, wishes: ANSWER, window: { open: false, deadline: "2020-01-10", reopenedUntil: "" } });
    page();
    expect(await screen.findByText(/The deadline has passed/)).toBeTruthy();
    expect(screen.getByText("Your week")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change my answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
});
