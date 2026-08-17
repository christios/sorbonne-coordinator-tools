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
});
