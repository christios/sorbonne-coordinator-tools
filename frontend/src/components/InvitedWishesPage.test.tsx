import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import * as auth from "@/services/auth";
import * as microsoft from "@/services/microsoftSignIn";
import type { WishCollection, Wishes } from "@/services/teacherWishes";
import * as invite from "@/services/wishInvite";

const COLLECTION: WishCollection = {
  termCode: "262720", deadline: "2099-01-10", message: "Tell us by January.", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
};
const ANSWER: Wishes = {
  status: "submitted", blocks: [{ id: "run", kind: "constraint", days: [2], from: 14, to: 16, repeat: "all", week: "", comment: "School run" }],
  limits: {}, limitKinds: {}, needs: "", note: "Mornings, please", comments: {}, lines: [],
  overCapReason: "", source: "invitation", submittedAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z", updatedBy: "",
};
const FORM: invite.InviteeForm = {
  semesterName: "Semester 2 2026-27",
  teacherName: "Joumana El Rifai",
  email: "joumana.rifai@gmail.com",
  collection: COLLECTION,
  wishes: null,
  window: { open: true, deadline: "2099-01-10", reopenedUntil: "" },
  previous: { termCode: "262710", semesterName: "Semester 1 2026-27", wishes: ANSWER },
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


// The guided tour is taken once in a browser before the form is used: here it has been.
beforeEach(() => {
  window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
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

  it("offers Microsoft beside Google once it is set up, and signs in with the token it gives", async () => {
    vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({
      configured: true,
      clientId: "client.apps.googleusercontent.com",
      microsoftClientId: "microsoft-app",
    });
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "Semester 2 2026-27", teacherName: "Joumana El Rifai", email: "j************@outlook.com",
      deadline: "2099-01-10", message: "", signedIn: false,
    });
    const popup = vi.spyOn(microsoft, "signInWithMicrosoft").mockResolvedValue("microsoft-id-token");
    const signIn = vi.spyOn(invite, "signInInvitee").mockResolvedValue(FORM);
    page();
    expect(await screen.findByText(/Use Google for a Gmail address, Microsoft for an Outlook or Hotmail one/)).toBeTruthy();
    expect(screen.getByTestId("google-sign-in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("the-code", "microsoft-id-token", "microsoft"));
    expect(popup).toHaveBeenCalledWith("microsoft-app");
  });

  it("says why when Microsoft's sign-in did not finish", async () => {
    vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "google", microsoftClientId: "microsoft-app" });
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "", teacherName: "Joumana El Rifai", email: "j***@outlook.com", deadline: "", message: "", signedIn: false,
    });
    vi.spyOn(microsoft, "signInWithMicrosoft").mockRejectedValue(new Error("The Microsoft sign-in was closed before it finished."));
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Microsoft" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The Microsoft sign-in was closed before it finished.");
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
    // The teacher answering for themselves gets the how-to over the calendar.
    expect(screen.getByText("Drag across the hours")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start from it" }));
    expect(screen.getByRole("button", { name: /^Tuesday \d+ \w+ 14:00: hard constraint, whole semester/ })).toBeTruthy();
    // Submit is on the last page, after the limits and the needs.
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next: Needs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("the-code", expect.objectContaining({ submit: true, note: "Mornings, please" })));
    // The end, said large: thanks, all done, nothing more to do; then what was sent.
    const thanks = await screen.findByRole("heading", { name: /^Thank you, / });
    const end = thanks.closest("[data-submitted]") as HTMLElement;
    expect(end.textContent).toContain("Your answer is submitted. You’re all done.");
    expect(end.textContent).toContain("There is nothing more to do: you can close this page.");
    // Under it, the whole request read back, said to be a summary of it.
    expect(screen.getByRole("heading", { name: "Summary of your requests for Semester 2 2026-27" })).toBeTruthy();
    // Changing it is a button in the thank-you, and one floating at the foot of the window.
    const inThanks = within(end).getByRole("button", { name: "Change my answer" });
    const floating = document.querySelector("[data-change-answer]") as HTMLElement;
    expect(floating.textContent).toBe(" Change my answer");
    expect(screen.getAllByRole("button", { name: "Change my answer" })).toHaveLength(2);
    // Either takes the teacher back into the form, and both go.
    fireEvent.click(inThanks);
    expect(await screen.findByRole("button", { name: /^Next: Limits/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change my answer" })).toBeNull();
    expect(document.querySelector("[data-change-answer]")).toBeNull();
  });

  it("floats Change my answer over an answer already sent, while it can change", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "", teacherName: "Joumana El Rifai", email: "j***@gmail.com", deadline: "", message: "", signedIn: true,
    });
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, wishes: ANSWER });
    page();
    expect(await screen.findByText(/Your answer is submitted: nothing more to do/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Next: Limits/ })).toBeNull();
    fireEvent.click(document.querySelector("[data-change-answer]") as HTMLElement);
    expect(await screen.findByRole("button", { name: /^Next: Limits/ })).toBeTruthy();
    expect(document.querySelector("[data-change-answer]")).toBeNull();
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

  it("opens on the preferences for somebody not on Active teachers, whatever empty course step the server sends", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
      semesterName: "Semester 2 2026-27", teacherName: "Nadia New", email: "n***@gmail.com", deadline: "", message: "", signedIn: true,
    });
    // An empty list where "no course step" belongs broke the page for people added by hand (27 Nov 2026).
    const empty = [] as unknown as invite.InviteeForm["coursePlans"];
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, teacherName: "Nadia New", previous: null, reductions: null, coursePlans: empty });
    page();
    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Course schedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Hour reductions/ })).toBeNull();
  });
});
