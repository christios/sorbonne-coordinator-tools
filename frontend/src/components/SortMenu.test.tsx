import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SortMenu } from "@/components/SortMenu";

const OPTIONS = [
  { value: "groups", label: "As on Groups & CRNs" },
  { value: "left", label: "Most hours left" },
];

describe("a sort behind an icon", () => {
  it("says the order it is in, and changes it from its menu", async () => {
    const onChange = vi.fn();
    render(<SortMenu value="groups" options={OPTIONS} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sort by: As on Groups & CRNs" }));
    fireEvent.click(await screen.findByRole("option", { name: "Most hours left" }));

    expect(onChange).toHaveBeenCalledWith("left");
  });

  it("marks the order that is not the list's own", () => {
    render(<SortMenu value="left" options={OPTIONS} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sort by: Most hours left" }).className).toContain("bg-[#1f4e79]");
  });
});
