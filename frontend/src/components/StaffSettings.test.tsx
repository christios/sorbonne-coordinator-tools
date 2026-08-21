import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffSettings } from "@/components/StaffSettings";
import { StaffContext } from "@/components/useStaffUser";
import * as directory from "@/services/staffDirectory";

const ADMIN = { email: "coordinator@sorbonne.ae", name: "Coordinator", isAdmin: true };
const COLLEAGUE: directory.CoordinatorAccount = {
  email: "colleague@sorbonne.ae",
  name: "Dr Colleague",
  isAdmin: false,
  isActive: true,
  invitedBy: ADMIN.email,
  createdAt: "2026-08-01T09:00:00+00:00",
  lastSeenAt: "2026-08-20T09:00:00+00:00",
};

function renderSettings(user = ADMIN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StaffContext.Provider value={user}>
        <StaffSettings />
      </StaffContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(directory, "fetchStaffList").mockResolvedValue({
    accounts: [COLLEAGUE],
    owners: [ADMIN.email],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("StaffSettings", () => {
  it("shows who has been invited and who the environment always lets in", async () => {
    renderSettings();

    expect(await screen.findByText("Dr Colleague")).toBeTruthy();
    expect(screen.getByText(/last signed in/)).toBeTruthy();
    expect(screen.getByText("Owners")).toBeTruthy();
    expect(screen.getByText(ADMIN.email)).toBeTruthy();
  });

  it("invites a colleague by e-mail, as an administrator when asked", async () => {
    const invite = vi.spyOn(directory, "inviteCoordinator").mockResolvedValue({
      ...COLLEAGUE,
      email: "new@sorbonne.ae",
      isAdmin: true,
    });
    renderSettings();

    fireEvent.change(await screen.findByLabelText(/Invite a colleague/), {
      target: { value: "new@sorbonne.ae" },
    });
    fireEvent.click(screen.getByLabelText("Administrator"));
    fireEvent.click(screen.getByRole("button", { name: /Invite/ }));

    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({ email: "new@sorbonne.ae", isAdmin: true }),
    );
  });

  it("promotes and suspends an account", async () => {
    const update = vi.spyOn(directory, "updateCoordinator").mockResolvedValue(COLLEAGUE);
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Make admin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenNthCalledWith(1, COLLEAGUE.email, { isAdmin: true });
    expect(update).toHaveBeenNthCalledWith(2, COLLEAGUE.email, { isActive: false });
  });

  it("asks before removing somebody's access", async () => {
    const remove = vi.spyOn(directory, "removeCoordinator").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: `Remove ${COLLEAGUE.email}` }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(COLLEAGUE.email));
  });

  it("says plainly when the server refuses a change", async () => {
    vi.spyOn(directory, "updateCoordinator").mockRejectedValue(
      new Error("You cannot change your own access here."),
    );
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Make admin/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("You cannot change your own access here.");
  });

  it("is closed to a coordinator who does not administer the application", async () => {
    renderSettings({ ...ADMIN, isAdmin: false });

    expect(await screen.findByText(/Only an administrator can manage who may sign in/)).toBeTruthy();
    expect(directory.fetchStaffList).not.toHaveBeenCalled();
  });
});
