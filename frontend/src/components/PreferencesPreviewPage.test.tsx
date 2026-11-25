import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesPreviewPage } from "@/components/PreferencesPreviewPage";
import * as auth from "@/services/auth";
import * as invite from "@/services/wishInvite";
import * as preview from "@/services/wishPreview";

const SEMESTER: preview.PreviewSemester = {
  term: "262720",
  name: "Semester 2 2026-27",
  collection: {
    termCode: "262720", deadline: "2099-01-10", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
    mustQuota: 2, cantCap: 12, openedAt: "", openedBy: "",
  },
  calendar: { weekOne: "2027-01-11", weeks: 2, without: [], holidays: [] },
  weeks: [
    { week: 1, monday: "2027-01-11", holidays: [] },
    { week: 2, monday: "2027-01-18", holidays: [] },
  ],
  rules: {
    service: 192,
    rules: [{ kind: "phd", group: "safir", label: "PhD students", unit: "students", rule: "5 h each", per: 5, cap: 20 }],
  },
};

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PreferencesPreviewPage term="262720" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "client.apps.googleusercontent.com" });
  window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
});

describe("the coordinators' preview of a teacher's page", () => {
  it("is the teacher's page with every step, says it is a preview, and saves nothing to the server", async () => {
    vi.spyOn(preview, "readPreviewSemester").mockResolvedValue(SEMESTER);
    const sent = [
      vi.spyOn(invite, "saveInviteeReductions"),
      vi.spyOn(invite, "saveInviteeCoursePlans"),
      vi.spyOn(invite, "saveInviteeAnswer"),
      vi.spyOn(invite, "fetchInvitation"),
    ];
    page();
    expect(await screen.findByText(/Preview: what a teacher sees\./)).toBeTruthy();
    expect(screen.getByText(/Nothing here is saved/)).toBeTruthy();
    await screen.findByRole("button", { name: /Hour reductions/ });
    for (const step of ["Hour reductions", "Course schedule", "Preferences and constraints"]) {
      expect(screen.getByRole("button", { name: new RegExp(step) })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Save and go on to your course schedule/ }));
    expect(await screen.findByRole("table", { name: "SAMPLE-101 sessions week by week" })).toBeTruthy();
    // Start again: back to the first step, as on opening the link.
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Hour reductions/ }).getAttribute("aria-current")).toBe("step"));
    for (const call of sent) expect(call).not.toHaveBeenCalled();
  });

  it("asks to sign in to Coordinator Tools when the semester cannot be read", async () => {
    vi.spyOn(preview, "readPreviewSemester").mockRejectedValue(new Error("Sign in first"));
    page();
    expect(await screen.findByText("This preview could not be opened")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Coordinator Tools" }).getAttribute("href")).toBe("/");
  });
});
