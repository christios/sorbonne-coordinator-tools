import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeField } from "./TimeField";

describe("TimeField", () => {
  it("renders the shared MUI X picker as a 24-hour time field", () => {
    render(<TimeField label="Start time" value="10:00" onChange={vi.fn()} />);

    expect(screen.getByText("Start time")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Hours" }).textContent).toBe("10");
    expect(screen.getByRole("spinbutton", { name: "Minutes" }).textContent).toBe("00");
    expect(screen.queryByRole("button", { name: "Choose time, selected time is 10:00" })).toBeNull();

    fireEvent.click(screen.getByRole("spinbutton", { name: "Hours" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Hours" }), { altKey: true, key: "ArrowDown" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
