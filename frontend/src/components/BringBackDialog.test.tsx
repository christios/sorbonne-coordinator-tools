import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BringBackDialog, type DismissedGroup } from "@/components/BringBackDialog";

const GROUPS: DismissedGroup[] = [
  {
    id: "t1",
    title: "Grace Younes",
    items: [
      { key: "k1", label: "Portal short 8 h", detail: "The portal books 8 h fewer than the plan.", by: "Chris", at: "2026-09-20T10:00:00Z" },
      { key: "k2", label: "Requisition over", detail: "The requisition pays for more than the plan." },
    ],
  },
  { id: "t2", title: "Ahmed Slimani", items: [{ key: "k3", label: "Portal over 15 h", detail: "The portal books 15 h more." }] },
];

describe("bringing dismissed warnings back", () => {
  it("brings back nothing until something is ticked, then only what is", () => {
    const onBringBack = vi.fn();
    render(<BringBackDialog groups={GROUPS} busy={false} onBringBack={onBringBack} onClose={() => {}} />);

    const confirm = screen.getByRole("button", { name: "Bring back" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    // Who dismissed it, and when, beside each.
    expect(screen.getByText(/Dismissed by Chris on/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Bring back: The portal books 15 h more." }));
    fireEvent.click(screen.getByRole("button", { name: "Bring back 1" }));

    expect(onBringBack).toHaveBeenCalledWith(["k3"]);
  });

  it("ticks a row's warnings all at once from the row's own box, and says when only some are", () => {
    const onBringBack = vi.fn();
    render(<BringBackDialog groups={GROUPS} busy={false} onBringBack={onBringBack} onClose={() => {}} />);
    const row = screen.getByRole("checkbox", { name: "All of Grace Younes's dismissed warnings" }) as HTMLInputElement;

    fireEvent.click(screen.getByRole("checkbox", { name: "Bring back: The portal books 8 h fewer than the plan." }));
    expect(row.indeterminate).toBe(true);

    fireEvent.click(row);
    expect(row.checked).toBe(true);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Bring back 2" }));
    expect(onBringBack).toHaveBeenCalledWith(["k1", "k2"]);
  });

  it("ticks and unticks everything", () => {
    render(<BringBackDialog groups={GROUPS} busy={false} onBringBack={() => {}} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Tick all 3" }));
    expect(screen.getByRole("button", { name: "Bring back 3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Untick all" }));
    expect(screen.getByRole("button", { name: "Bring back" })).toBeTruthy();
  });
});
