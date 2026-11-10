import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WishesForm } from "@/components/WishesForm";
import type { WishCollection } from "@/services/teacherWishes";

const COLLECTION: WishCollection = {
  termCode: "262720",
  deadline: "2026-12-10",
  message: "",
  days: [1, 2, 3, 4, 5],
  firstHour: 8,
  lastHour: 19,
  mustQuota: 2,
  cantCap: 3,
  openedAt: "",
  openedBy: "",
};

const cell = (day: string, hour: number) => screen.getByRole("button", { name: new RegExp(`^${day} ${hour}:00: `) });

describe("a teacher's wishes, filled in", () => {
  it("paints every hour a quick drag passes over, not only those it stopped on", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    fireEvent.pointerDown(cell("Tuesday", 14));
    // Straight from 14:00 to 17:00: the pointer never stopped on 15:00 or 16:00.
    fireEvent.pointerOver(cell("Tuesday", 17));
    fireEvent.pointerUp(window);
    for (const hour of [14, 15, 16, 17]) expect(cell("Tuesday", hour).getAttribute("aria-label")).toContain("can't teach");
    expect(cell("Tuesday", 18).getAttribute("aria-label")).toContain("fine");
    expect(screen.getByText("Can't teach Tue 14:00–18:00")).toBeTruthy();
  });

  it("is painted from the keyboard too", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    // Enter or Space on a cell is a click with no pointer behind it.
    fireEvent.click(cell("Monday", 9));
    expect(cell("Monday", 9).getAttribute("aria-label")).toContain("can't teach");
  });

  it("keeps to the Must quota as it is chosen, and asks why past the can't-teach cap", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={onSave} />);
    fireEvent.click(cell("Tuesday", 14));
    fireEvent.click(cell("Tuesday", 15));
    fireEvent.click(cell("Tuesday", 16));
    fireEvent.click(cell("Tuesday", 17));
    fireEvent.click(cell("Thursday", 9));
    fireEvent.click(cell("Friday", 11));
    const musts = () => screen.getAllByRole("radio", { name: "Must" }) as HTMLButtonElement[];
    expect(musts()).toHaveLength(3);
    fireEvent.click(musts()[0]);
    fireEvent.click(musts()[1]);
    // Two of two used: the third waits until one is let go.
    expect(musts()[2].disabled).toBe(true);
    expect(screen.getByText(/2 of 2 Musts used/)).toBeTruthy();

    // Six hours can't be taught, over the cap of three: not without a reason.
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Say why 6 hours can't be taught/)).toBeTruthy();
    // A draft is kept as it stands.
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ submit: false }));
  });
});
