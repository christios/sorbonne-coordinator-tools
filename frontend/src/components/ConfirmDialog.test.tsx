import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("uses an in-app dialog rather than a browser confirmation", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="Remove course?" description="This cannot be undone." confirmLabel="Remove course" onConfirm={onConfirm} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Remove course?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove course" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("will not confirm twice while the caller is busy", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open busy title="Remove 40?" description="Only the list forgets them." confirmLabel="Remove" onConfirm={onConfirm} onClose={vi.fn()} />);

    // Forty removals is forty round-trips. Without this the button stays live and
    // inviting throughout, and a second press starts the whole run again.
    const button = screen.getByRole("button", { name: "Working…" });
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("says it is working, so a slow removal does not read as a dead button", () => {
    render(<ConfirmDialog open busy title="Remove 40?" description="Only the list forgets them." confirmLabel="Remove" onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Working…" })).toBeTruthy();
  });
});
