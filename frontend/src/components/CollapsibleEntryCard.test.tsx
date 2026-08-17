import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollapsibleEntryCard } from "./CollapsibleEntryCard";

describe("CollapsibleEntryCard", () => {
  it("keeps entry details out of the page until the header is opened", () => {
    const onToggle = vi.fn();
    render(<CollapsibleEntryCard id="entry-1" expanded={false} onToggle={onToggle} toggleLabel="Expand entry: Example" title="Example" summary="Summary"><label>Detail<input /></label></CollapsibleEntryCard>);

    expect(screen.queryByLabelText("Detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand entry: Example" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
