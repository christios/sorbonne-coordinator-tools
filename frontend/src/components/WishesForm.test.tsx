import { fireEvent, render, screen, within } from "@testing-library/react";
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
const said = (day: string, hour: number) => cell(day, hour).getAttribute("aria-label") ?? "";
/** A press and a release on a painted hour, without moving: it opens that block. */
const openBlock = (day: string, hour: number) => {
  fireEvent.pointerDown(cell(day, hour));
  fireEvent.pointerUp(window);
  return screen.getByRole("dialog");
};

describe("a teacher's wishes, filled in", () => {
  it("paints every hour a quick drag passes over, not only those it stopped on", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    fireEvent.pointerDown(cell("Tuesday", 14));
    // Straight from 14:00 to 17:00: the pointer never stopped on 15:00 or 16:00.
    fireEvent.pointerOver(cell("Tuesday", 17));
    fireEvent.pointerUp(window);
    for (const hour of [14, 15, 16, 17]) expect(said("Tuesday", hour)).toContain("can't teach");
    expect(said("Tuesday", 18)).toContain("fine");
  });

  it("is painted from the keyboard too, and a painted hour opens its block from there", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    // Enter or Space on a cell is a click with no pointer behind it.
    fireEvent.click(cell("Monday", 9));
    expect(said("Monday", 9)).toContain("can't teach");
    fireEvent.click(cell("Monday", 9));
    expect(screen.getByRole("dialog", { name: "Can't teach Mon 09:00–10:00" })).toBeTruthy();
    expect(said("Monday", 9)).toContain("can't teach");
  });

  it("says on the week itself how much a block matters and why, and keeps both", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={onSave} />);
    fireEvent.pointerDown(cell("Tuesday", 14));
    fireEvent.pointerOver(cell("Tuesday", 17));
    fireEvent.pointerUp(window);
    expect(said("Tuesday", 15)).toContain("a Would like");

    const block = openBlock("Tuesday", 15);
    expect(block.getAttribute("aria-label")).toBe("Can't teach Tue 14:00–18:00");
    fireEvent.click(within(block).getByRole("radio", { name: "Must" }));
    fireEvent.change(within(block).getByPlaceholderText("Why it matters (optional)"), { target: { value: "School run" } });
    fireEvent.click(within(block).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Drawn solid now, as a Must.
    expect(said("Tuesday", 14)).toContain("a Must");
    expect(screen.getByText("1 of 2 Musts used")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ levels: { "cant:14-18:2": "must" }, comments: { "cant:14-18:2": "School run" }, submit: false }),
    );
  });

  it("takes a whole block away from its pop-over", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    fireEvent.pointerDown(cell("Thursday", 10));
    fireEvent.pointerOver(cell("Thursday", 11));
    fireEvent.pointerUp(window);
    fireEvent.click(within(openBlock("Thursday", 10)).getByRole("button", { name: "Remove" }));
    expect(said("Thursday", 10)).toContain("fine");
    expect(said("Thursday", 11)).toContain("fine");
  });

  it("keeps to the Must quota across the week and the limits, and asks why past the can't-teach cap", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={onSave} />);
    // Four blocks at four different hours: four wishes (the same hours on two days would be one).
    for (const [day, hour] of [["Monday", 9], ["Wednesday", 11], ["Friday", 13], ["Thursday", 16]] as const) fireEvent.click(cell(day, hour));
    fireEvent.click(within(openBlock("Monday", 9)).getByRole("radio", { name: "Must" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(within(openBlock("Wednesday", 11)).getByRole("radio", { name: "Must" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Two of two used: a third block waits until one is let go.
    const third = openBlock("Friday", 13);
    expect((within(third).getByRole("radio", { name: "Must" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(third).getByText(/All 2 Musts are used/)).toBeTruthy();
    fireEvent.click(within(third).getByRole("button", { name: "Done" }));

    // Four hours can't be taught, over the cap of three: not without a reason.
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Say why 4 hours can't be taught/)).toBeTruthy();
    // A draft is kept as it stands.
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ submit: false }));
  });

  it("tells whoever holds it when it has changed, and when it is back as it was", () => {
    const onDirtyChange = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(cell("Monday", 9));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(openBlock("Monday", 9)).getByRole("button", { name: "Remove" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
