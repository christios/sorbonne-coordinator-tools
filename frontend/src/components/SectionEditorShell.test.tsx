import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SectionEditorShell } from "./SectionEditorShell";

describe("SectionEditorShell", () => {
  it("provides a numbered, focused section canvas for every builder", () => {
    const onSectionChange = vi.fn();
    const onHeaderCollapseChange = vi.fn();
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
        onHeaderCollapseChange={onHeaderCollapseChange}
      >
        <p>Details canvas</p>
      </SectionEditorShell>,
    );

    expect(screen.getByRole("navigation", { name: "Builder sections" })).toBeTruthy();
    expect(screen.getByText("Details canvas")).toBeTruthy();
    expect(screen.getByTestId("editor-workspace").className).toContain("lg:overflow-y-auto");
    expect(screen.getByTestId("editor-workspace").className).toContain("lg:min-h-0");
    expect(screen.getByTestId("editor-workspace").parentElement?.parentElement?.className).toContain("[--page-cap:98rem]");
    expect(screen.getByTestId("editor-workspace").parentElement?.parentElement?.className).toContain("page-gutters");
    fireEvent.click(screen.getByRole("button", { name: "2. Review" }));
    expect(onSectionChange).toHaveBeenCalledWith("review");

    fireEvent.scroll(screen.getByTestId("editor-workspace").parentElement?.parentElement as HTMLElement, {
      target: { scrollTop: 72 },
    });
    expect(onHeaderCollapseChange).not.toHaveBeenCalled();

    fireEvent.scroll(screen.getByTestId("editor-workspace"), {
      target: { scrollTop: 72 },
    });
    expect(onHeaderCollapseChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("editor-workspace").className).toContain("lg:pb-36");
    expect(screen.getByTestId("editor-workspace").className).not.toContain("transition-[padding]");

    fireEvent.scroll(screen.getByTestId("editor-workspace"), {
      target: { scrollTop: 48 },
    });
    expect(onHeaderCollapseChange).toHaveBeenLastCalledWith(true);

    fireEvent.scroll(screen.getByTestId("editor-workspace"), {
      target: { scrollTop: 0 },
    });
    expect(onHeaderCollapseChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("editor-workspace").className).not.toContain("lg:pb-36");
  });

  it("counts what each section still lacks, marks the current one, and opens a section at its top", () => {
    const props = {
      backLabel: "Back to library",
      onBack: vi.fn(),
      eyebrow: "2026-2027",
      title: "Example record",
      subtitle: "Builder",
      actions: null,
      sections: [{ id: "details", label: "1. Details" }, { id: "review", label: "2. Review" }],
      onSectionChange: vi.fn(),
      sectionCounts: { review: 3 },
    };
    const { rerender } = render(<SectionEditorShell {...props} activeSection="details"><p>Canvas</p></SectionEditorShell>);

    expect(screen.getByRole("button", { name: "1. Details" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: "2. Review, 3 to fill in" }).getAttribute("aria-current")).toBeNull();

    const workspace = screen.getByTestId("editor-workspace");
    workspace.scrollTop = 400;
    rerender(<SectionEditorShell {...props} activeSection="review"><p>Canvas</p></SectionEditorShell>);
    expect(workspace.scrollTop).toBe(0);
    expect(screen.getByRole("button", { name: "2. Review, 3 to fill in" }).getAttribute("aria-current")).toBe("step");
  });

  it("puts the record's actions in a bar over the content, so the header matches every other screen's", () => {
    render(
      <SectionEditorShell
        backLabel="Back to library"
        onBack={vi.fn()}
        eyebrow="2026-2027"
        title="Example record"
        subtitle="Builder"
        actions={null}
        toolbar={<button type="button">Export</button>}
        sections={[{ id: "details", label: "1. Details" }]}
        activeSection="details"
        onSectionChange={vi.fn()}
      >
        <p>Canvas</p>
      </SectionEditorShell>,
    );

    const toolbar = screen.getByTestId("editor-toolbar");
    expect(toolbar.contains(screen.getByRole("button", { name: "Export" }))).toBe(true);
    expect(screen.getByTestId("editor-workspace").contains(toolbar)).toBe(true);
    expect(screen.getByTestId("editor-header").contains(toolbar)).toBe(false);
  });
});
