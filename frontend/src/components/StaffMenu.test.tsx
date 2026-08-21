import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffMenu } from "@/components/StaffMenu";
import { StaffContext } from "@/components/useStaffUser";
import * as auth from "@/services/auth";

const USER = { email: "coordinator@sorbonne.ae", name: "Coordinator" };

afterEach(() => vi.restoreAllMocks());

describe("StaffMenu", () => {
  it("names the signed-in coordinator", () => {
    render(
      <StaffContext.Provider value={USER}>
        <StaffMenu />
      </StaffContext.Provider>,
    );

    expect(screen.getByText("Coordinator")).toBeTruthy();
    expect(screen.getByText("Coordinator").getAttribute("title")).toBe(USER.email);
  });

  it("ends the session on the server, not just in the browser", async () => {
    const signOut = vi.spyOn(auth, "signOut").mockResolvedValue();
    render(
      <StaffContext.Provider value={USER}>
        <StaffMenu />
      </StaffContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  it("renders nothing when nobody is signed in", () => {
    const { container } = render(<StaffMenu />);

    expect(container.firstChild).toBeNull();
  });
});
