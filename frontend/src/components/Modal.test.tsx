import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/Modal";

describe("a dialog", () => {
  it("has a close button in its corner, which closes it", () => {
    // Escape and a click outside always closed it; neither can be found by looking.
    const onClose = vi.fn();
    render(
      <Modal open title="CRN 23665" onClose={onClose}>
        <p>Who teaches it</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
