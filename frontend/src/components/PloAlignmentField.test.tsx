import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PloAlignmentField } from "./SyllabusEditor";

const options = [
  { value: "PLO 1", label: "PLO 1: First outcome" },
  { value: "PLO 2", label: "PLO 2: Second outcome" },
];

describe("PloAlignmentField", () => {
  it("adds one PLO at a time and lets coordinators remove an existing alignment", () => {
    const onChange = vi.fn();
    render(
      <PloAlignmentField
        label="Aligned PLOs"
        pickerLabel="Add aligned PLO to CLO 1"
        value="PLO 1"
        onChange={onChange}
        options={options}
      />,
    );

    expect(screen.getByRole("list", { name: "Selected Aligned PLOs" })).toBeTruthy();
    expect(screen.getByText("PLO 1: First outcome")).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Add aligned PLO to CLO 1" }));
    fireEvent.click(screen.getByRole("option", { name: "PLO 2: Second outcome" }));
    expect(onChange).toHaveBeenCalledWith("PLO 1\nPLO 2");

    fireEvent.click(screen.getByRole("button", { name: "Remove PLO 1: First outcome from Aligned PLOs" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("coalesces duplicate and legacy-formatted PLO selections", () => {
    render(
      <PloAlignmentField
        label="Aligned PLOs"
        pickerLabel="Add aligned PLO to CLO 1"
        value={"PLO 1. Previous label\nPLO 1\nPLO 2"}
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("PLO 1: First outcome")).toBeTruthy();
    expect(screen.getByText("PLO 2: Second outcome")).toBeTruthy();
  });
});
