import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import * as auth from "@/services/auth";
import type { ReductionItem, ReductionSheet } from "@/services/hourReductions";
import type { WishCollection } from "@/services/teacherWishes";
import * as invite from "@/services/wishInvite";

const COLLECTION: WishCollection = {
  termCode: "262710", deadline: "2099-01-10", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
};
const item = (over: Partial<ReductionItem> & Pick<ReductionItem, "kind" | "group" | "label" | "unit">): ReductionItem => ({
  rule: "", per: null, cap: null, amount: 0, detail: "", hours: 0, state: "", updatedAt: "", updatedBy: "", validatedAt: "",
  ...over,
});
const SHEET: ReductionSheet = {
  year: "2026-2027",
  service: 192,
  items: [
    item({ kind: "phd", group: "safir", label: "PhD students", unit: "students", per: 5, cap: 20,
      rule: "5 h for each PhD student inscribed in or financed by SAFIR, up to 20 h." }),
    item({ kind: "internships", group: "safir", label: "Internship supervision", unit: "students", per: 0.5, cap: 10 }),
    item({ kind: "committees", group: "department", label: "University committees", unit: "committees", per: 3,
      options: [{ key: "budget", label: "Budget", hours: 3 }, { key: "ethics", label: "Ethics", hours: 3 }],
      detail: "budget", amount: 1, hours: 3, state: "set" }),
  ],
  total: 3,
  owed: 189,
  declaredAt: "",
  declaredBy: "",
  note: "",
};
const FORM: invite.InviteeForm = {
  semesterName: "Semester 1 2026-27",
  teacherName: "Stavros Christopoulos",
  email: "stavros@example.com",
  collection: COLLECTION,
  wishes: null,
  window: { open: true, deadline: "2099-01-10", reopenedUntil: "" },
  previous: null,
  reductions: SHEET,
};

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InvitedWishesPage code="the-code" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
  vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "client.apps.googleusercontent.com" });
  vi.spyOn(invite, "fetchInvitation").mockResolvedValue({
    semesterName: "Semester 1 2026-27", teacherName: "Stavros Christopoulos", email: "s***@example.com",
    deadline: "", message: "", signedIn: true,
  });
});

describe("a full-timer's first step: their hour reductions", () => {
  it("comes before the preferences, adds up as it is typed, and goes on once saved", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue(FORM);
    const declared = { ...SHEET, declaredAt: "2026-11-16T09:00:00Z", total: 18, owed: 174 };
    const save = vi.spyOn(invite, "saveInviteeReductions").mockResolvedValue({ ...FORM, reductions: declared });
    page();

    expect(await screen.findByText("Your hour reductions for 2026–2027")).toBeTruthy();
    // Not the form yet, and step 2 waits for step 1.
    expect(screen.queryByRole("heading", { name: "Your week" })).toBeNull();
    expect((screen.getByRole("button", { name: /Preferences and constraints/ }) as HTMLButtonElement).disabled).toBe(true);
    // The department's own are there to read, not to change.
    expect(screen.queryByRole("checkbox", { name: "Budget committee" })).toBeNull();
    expect(screen.getByText("Budget")).toBeTruthy();

    fireEvent.change(screen.getByRole("spinbutton", { name: "PhD students" }), { target: { value: "3" } });
    expect(screen.getByText(/Declared, to be validated/)).toBeTruthy();
    // 3 × 5 h, and the committee's 3 h: 18 h off 192.
    const totals = screen.getByText("Reductions").closest("div") as HTMLElement;
    expect(within(totals).getByText("18 h")).toBeTruthy();
    expect(within(totals).getByText("174 h")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save and go on to your preferences" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        "the-code",
        { phd: { amount: 3, detail: "" }, internships: { amount: 0, detail: "" } },
        "",
      ),
    );
    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
    // And back, with nothing lost.
    fireEvent.click(screen.getByRole("button", { name: /Hour reductions/ }));
    expect(await screen.findByText("Your hour reductions for 2026–2027")).toBeTruthy();
  });

  it("opens on the preferences once it has been through them, with step 1 a click away", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, reductions: { ...SHEET, declaredAt: "2026-11-16T09:00:00Z" } });
    page();

    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hour reductions/ })).toBeTruthy();
  });

  it("is not there for anybody who is not full time", async () => {
    vi.spyOn(invite, "fetchInviteeForm").mockResolvedValue({ ...FORM, reductions: null });
    page();

    expect(await screen.findByRole("heading", { name: "Your week" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Steps" })).toBeNull();
    expect(screen.queryByText(/hour reductions/i)).toBeNull();
  });
});
