import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThisBrowser } from "@/components/ThisBrowser";
import * as history from "@/services/pullHistory";
import * as roster from "@/services/rosterStore";

afterEach(() => vi.restoreAllMocks());

describe("Settings → This browser", () => {
  it("says how many names it holds, and forgets them after asking once", async () => {
    vi.spyOn(roster, "namesHeld").mockResolvedValue({ A001: "Amira Haddad", A002: "Karim Nasser" });
    vi.spyOn(roster, "latestPullAt").mockResolvedValue(null);
    const forget = vi.spyOn(roster, "forgetRosters").mockResolvedValue();
    const forgetPast = vi.spyOn(history, "forgetHistory").mockResolvedValue();
    render(<ThisBrowser />);

    expect(await screen.findByText(/2 students named in this browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget stored rosters" }));
    expect(await screen.findByText(/No student leaves the list/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget rosters" }));

    await waitFor(() => expect(forget).toHaveBeenCalled());
    expect(forgetPast).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Back up the history" })).toBeTruthy();
  });
});
