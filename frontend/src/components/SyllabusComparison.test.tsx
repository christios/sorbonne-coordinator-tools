import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffValue } from "./SyllabusComparison";
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
});
