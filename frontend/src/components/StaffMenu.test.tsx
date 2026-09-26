import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffMenu } from "@/components/StaffMenu";
import { StaffContext } from "@/components/useStaffUser";
import * as auth from "@/services/auth";
import type { SettingsSection } from "@/routes/toolRoute";

const USER = { email: "coordinator@sorbonne.ae", name: "Coordinator", isAdmin: false };
const ADMIN = { ...USER, isAdmin: true };

afterEach(() => vi.restoreAllMocks());

function open(user = USER, onOpenSettings?: (section: SettingsSection) => void) {
  render(
    <StaffContext.Provider value={user}>
      <StaffMenu onOpenSettings={onOpenSettings} />
    </StaffContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Coordinator/ }));
}

describe("StaffMenu", () => {
  it("names the signed-in coordinator", () => {
    render(
      <StaffContext.Provider value={USER}>
        <StaffMenu />
      </StaffContext.Provider>,
    );

    expect(screen.getByText("Coordinator").getAttribute("title")).toBe(USER.email);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("ends the session on the server, not just in the browser", () => {
    const signOut = vi.spyOn(auth, "signOut").mockResolvedValue();

    open();
    fireEvent.click(screen.getByRole("menuitem", { name: /Sign out/ }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  it("lists every page of Settings for an administrator, each opening its own", () => {
    // It used to offer Users alone, with the other two pages hidden as tabs inside it.
    const openSettings = vi.fn();

    open(ADMIN, openSettings);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "Users",
      "API tokens",
      "Checks",
      "Programme codes",
      "Semesters",
      "This browser",
      "Sign out",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: /API tokens/ }));

    expect(openSettings).toHaveBeenCalledWith("tokens");
  });

  it("offers everybody else the checks, to read, and nothing an administrator decides", () => {
    const openSettings = vi.fn();

    open(USER, openSettings);
    expect(screen.queryByRole("menuitem", { name: /Users/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /API tokens/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Checks/ }));

    expect(openSettings).toHaveBeenCalledWith("checks");
  });

  it("renders nothing when nobody is signed in", () => {
    const { container } = render(<StaffMenu />);

    expect(container.firstChild).toBeNull();
  });
});
