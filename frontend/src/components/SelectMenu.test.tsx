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

  it("allows several PLOs to be selected without closing the menu", () => {
    const onChange = vi.fn();
    render(<SelectMenu label="Aligned PLOs" value="PLO 1" onChange={onChange} options={[{ value: "PLO 1", label: "PLO 1: First outcome" }, { value: "PLO 2", label: "PLO 2: Second outcome" }]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Aligned PLOs" }));
    fireEvent.click(screen.getByRole("option", { name: "PLO 2: Second outcome" }));

    expect(onChange).toHaveBeenCalledWith("PLO 1\nPLO 2");
    expect(screen.getByRole("listbox", { name: "Aligned PLOs" })).toBeTruthy();
  });
});
