import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DateField } from "./DateField";

describe("DateField", () => {
  it("opens an in-app calendar picker from the compact date control", () => {
    const onChange = vi.fn();
    render(<DateField label="Contract from" value="2026-09-01" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Contract from" });
    expect(trigger.classList.contains("h-9")).toBe(true);

    fireEvent.click(trigger);
    expect(screen.getByRole("grid", { name: "Contract from calendar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("gridcell", { name: "Select 15 Sept 2026" }));

    expect(onChange).toHaveBeenCalledWith("2026-09-15");
  });

  it("keeps optional trailing controls inside the shared date field", () => {
    render(<DateField label="Assessment date" value="" onChange={vi.fn()} trailing={<button type="button">History</button>} />);

    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });
});
