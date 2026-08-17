import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComparisonStatus, DiffValue } from "./SyllabusComparison";
import { SyllabusChange } from "@/services/syllabi";

const change: SyllabusChange = {
  path: "description.overview",
  label: "Course description",
  left: "The course uses annual methods.",
  right: "The course adopts methods regularly.",
  kind: "changed",
  operations: [
    { type: "equal", text: "The course " },
    { type: "substitute", left: "uses", right: "adopts" },
    { type: "equal", text: " " },
    { type: "delete", text: "annual " },
    { type: "equal", text: "methods" },
    { type: "insert", text: " regularly" },
    { type: "equal", text: "." },
  ],
};

describe("DiffValue", () => {
  it("keeps the previous version plain and annotates operations in the newer version", () => {
    render(
      <div>
        <div data-testid="previous"><DiffValue change={change} value={change.left} side="left" /></div>
        <div data-testid="newer"><DiffValue change={change} value={change.right} side="right" /></div>
      </div>,
    );

    const previous = screen.getByTestId("previous");
    const newer = screen.getByTestId("newer");

    expect(previous.querySelectorAll("mark")).toHaveLength(0);
    expect(previous.textContent).toContain("The course uses annual methods.");
    const substitution = screen.getByLabelText("Substitution: uses replaced with adopts");

    expect(substitution.className).toContain("bg-[#fef0c7]");
    expect(substitution.textContent).toContain("uses → adopts");
    expect(newer.textContent).toContain("annual");
    expect(newer.textContent).toContain("regularly");
  });

  it("renders structured comparison values as fields instead of raw JSON", () => {
    render(<DiffValue value={[{ id: "assessment-1", type: "Final exam", weight: "40", clos: "CLO 1, CLO 2" }]} side="left" />);

    expect(screen.getByText("Final exam")).toBeTruthy();
    expect(screen.getByText("Weight")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.queryByText(/\{"id"/)).toBeNull();
  });

  it("labels comparable fields as kept, changed, or template-specific", () => {
    const { rerender } = render(<ComparisonStatus row={{ id: "description", label: "Course description", left: "Same", right: "Same", status: "mapped", kind: "unchanged" }} leftTemplate="SCEN" rightTemplate="Foundation Year" />);
    expect(screen.getByText("Kept")).toBeTruthy();

    rerender(<ComparisonStatus row={{ id: "description", label: "Course description", left: "Before", right: "After", status: "mapped", kind: "changed" }} leftTemplate="SCEN" rightTemplate="Foundation Year" />);
    expect(screen.getByText("Changed")).toBeTruthy();

    rerender(<ComparisonStatus row={{ id: "course-weight", label: "Course weight", left: null, right: "3", status: "right-only", kind: "changed" }} leftTemplate="SCEN" rightTemplate="Foundation Year" />);
    expect(screen.getByText("Only in Foundation Year")).toBeTruthy();
  });
});
