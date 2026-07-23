import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectMenu } from "./SelectMenu";

describe("SelectMenu", () => {
  it("shows its options in the branded menu and returns the selected value", () => {
    const onChange = vi.fn();
    render(<SelectMenu label="Starting point" value="" onChange={onChange} placeholder="Blank syllabus" options={[{ value: "", label: "Blank syllabus" }, { value: "source", label: "2025-2026 — Climate Change Law" }]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Starting point" }));
    expect(screen.getByRole("listbox", { name: "Starting point" })).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: "2025-2026 — Climate Change Law" }));
    expect(onChange).toHaveBeenCalledWith("source");
  });
});
