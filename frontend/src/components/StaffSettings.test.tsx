import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffSettings } from "@/components/StaffSettings";
import { StaffContext } from "@/components/useStaffUser";
import * as lists from "@/services/portalLists";
import * as directory from "@/services/staffDirectory";

const ADMIN = { email: "coordinator@sorbonne.ae", name: "Coordinator", isAdmin: true };
const COLLEAGUE: directory.CoordinatorAccount = {
  email: "colleague@sorbonne.ae",
  name: "Dr Colleague",
  displayName: "",
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
  window.history.replaceState(null, "", "#/settings");
  vi.spyOn(lists, "fetchChecks").mockResolvedValue([]);
  vi.spyOn(directory, "fetchStaffList").mockResolvedValue({
    accounts: [COLLEAGUE],
    owners: [{ email: ADMIN.email, name: ADMIN.email }],
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
      expect(invite).toHaveBeenCalledWith({ email: "new@sorbonne.ae", isAdmin: true, apps: {} }),
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

  it("offers a coordinator who does not administer the application only the checks, to read", async () => {
    renderSettings({ ...ADMIN, isAdmin: false });

    expect(await screen.findByText(/What the application warns about/)).toBeTruthy();
    // One page on offer needs no tabs, and the pages they may not use are not dangled.
    expect(screen.queryByRole("button", { name: /Users/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /API tokens/ })).toBeNull();
    expect(directory.fetchStaffList).not.toHaveBeenCalled();
  });

  it("does not open the users to somebody sent a link to them who is not an administrator", async () => {
    window.history.replaceState(null, "", "#/settings/users");
    renderSettings({ ...ADMIN, isAdmin: false });

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(directory.fetchStaffList).not.toHaveBeenCalled();
  });
});

/*
 * The menu used to offer one entry, Users, and the other two pages were tabs inside it —
 * so the menu hid two pages behind the first one's name. Each has its own entry and its
 * own address now, and the page opens on whichever was asked for.
 */
describe("which page of Settings is open", () => {
  it("is the one the address names", async () => {
    window.history.replaceState(null, "", "#/settings/checks");
    renderSettings();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(directory.fetchStaffList).not.toHaveBeenCalled();
  });

  it("offers an administrator all three, and writes the choice into the address", async () => {
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Checks/ }));

    expect(window.location.hash).toBe("#/settings/checks");
    expect(screen.getByRole("button", { name: /Users/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /API tokens/ })).toBeTruthy();
  });
});


describe("naming a colleague", () => {
  it("sends the name an administrator typed, and nothing else", async () => {
    const update = vi.spyOn(directory, "updateCoordinator").mockResolvedValue({
      ...COLLEAGUE,
      name: "Patricia Duval",
      displayName: "Patricia Duval",
    });
    renderSettings();
    await screen.findByText("Dr Colleague");

    // Two rows offer a name now — the colleague's and the owner's.
    fireEvent.click(screen.getAllByRole("button", { name: /Name/ })[0]);
    fireEvent.change(await screen.findByLabelText(`Name for ${COLLEAGUE.email}`), {
      target: { value: "Patricia Duval" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toEqual({ displayName: "Patricia Duval" });
  });
});


describe("naming an owner", () => {
  it("offers a name for somebody the environment admits", async () => {
    const update = vi.spyOn(directory, "updateCoordinator").mockResolvedValue({
      ...COLLEAGUE,
      email: ADMIN.email,
      name: "Christian Cayralat",
      displayName: "Christian Cayralat",
    });
    renderSettings();
    await screen.findByText("Owners");

    // The owner's row is the last one that offers a name.
    const nameButtons = screen.getAllByRole("button", { name: /Name/ });
    fireEvent.click(nameButtons[nameButtons.length - 1]);
    fireEvent.change(await screen.findByLabelText(`Name for ${ADMIN.email}`), {
      target: { value: "Christian Cayralat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toBe(ADMIN.email);
    expect(update.mock.calls[0][1]).toEqual({ displayName: "Christian Cayralat" });
  });

  it("does not offer to suspend or remove an owner", async () => {
    renderSettings();
    await screen.findByText("Owners");

    // Their access comes from the environment; offering the controls would imply otherwise.
    expect(screen.queryByRole("button", { name: `Remove ${ADMIN.email}` })).toBeNull();
  });
});
