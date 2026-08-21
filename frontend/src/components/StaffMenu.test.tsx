import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffMenu } from "@/components/StaffMenu";
import { StaffContext } from "@/components/useStaffUser";
import * as auth from "@/services/auth";

const USER = { email: "coordinator@sorbonne.ae", name: "Coordinator", isAdmin: false };
const ADMIN = { ...USER, isAdmin: true };

afterEach(() => vi.restoreAllMocks());

function open(user = USER, onOpenSettings?: () => void) {
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

  it("offers the staff list to an administrator only", () => {
    const openSettings = vi.fn();

    open(ADMIN, openSettings);
    fireEvent.click(screen.getByRole("menuitem", { name: /Users/ }));

    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("keeps settings out of the menu for everybody else", () => {
    open(USER, vi.fn());

    expect(screen.queryByRole("menuitem", { name: /Users/ })).toBeNull();
  });

  it("renders nothing when nobody is signed in", () => {
    const { container } = render(<StaffMenu />);

    expect(container.firstChild).toBeNull();
  });
});
