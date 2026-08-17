import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SectionEditorShell } from "./SectionEditorShell";

describe("SectionEditorShell", () => {
  it("provides a numbered, focused section canvas for every builder", () => {
    const onSectionChange = vi.fn();
    render(
      <SectionEditorShell
        backLabel="Back to library"
        onBack={vi.fn()}
        eyebrow="2026-2027"
        title="Example record"
        subtitle="Builder"
        actions={<button type="button">Save changes</button>}
        sections={[{ id: "details", label: "1. Details" }, { id: "review", label: "2. Review" }]}
        activeSection="details"
        onSectionChange={onSectionChange}
      >
        <p>Details canvas</p>
      </SectionEditorShell>,
    );

    expect(screen.getByRole("navigation", { name: "Builder sections" })).toBeTruthy();
    expect(screen.getByText("Details canvas")).toBeTruthy();
    expect(screen.getByTestId("editor-workspace").className).toContain("lg:overflow-y-auto");
    expect(screen.getByTestId("editor-workspace").className).toContain("lg:min-h-0");
    fireEvent.click(screen.getByRole("button", { name: "2. Review" }));
    expect(onSectionChange).toHaveBeenCalledWith("review");
  });
});
