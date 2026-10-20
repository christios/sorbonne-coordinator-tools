import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TimetablesButton } from "@/components/TimetablesButton";
import { setPortalChangesShown } from "@/services/portalChangesShown";

afterEach(() => setPortalChangesShown(true));

describe("the timetable export button", () => {
  it("asks whether the file shows the portal's changes before making it", async () => {
    const make = vi.fn(async () => ({ people: 1, withoutClasses: [] }));
    render(<TimetablesButton label="Export schedule" make={make} />);

    fireEvent.click(screen.getByRole("button", { name: /Export schedule/ }));
    expect(make).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Only what meets/ }));

    await waitFor(() => expect(make).toHaveBeenCalledWith({ portalChanges: false }));
  });

  it("offers first what the calendars are set to", async () => {
    setPortalChangesShown(false);
    render(<TimetablesButton make={vi.fn(async () => ({ people: 1, withoutClasses: [] }))} />);

    fireEvent.click(screen.getByRole("button", { name: /Timetables/ }));

    const choices = await screen.findAllByRole("button", { name: /With Portal changes|Only what meets/ });
    expect(choices.map((choice) => choice.textContent)).toEqual([
      expect.stringContaining("Only what meets"),
      expect.stringContaining("With Portal changes"),
    ]);
  });
});
