import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FolderMoveMenu } from "./FolderMoveMenu";

describe("FolderMoveMenu", () => {
  it("renders a compact folder-only trigger when used in a syllabus row", () => {
    render(
      <FolderMoveMenu
        compact
        label="Move Climate Policy to folder"
        value={null}
        onChange={vi.fn()}
        folders={[{ id: "folder-climate", name: "Climate courses" }]}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Move Climate Policy to folder" });
    expect(trigger.textContent).toBe("");
    expect(trigger.className).toContain("h-10");
  });

  it("filters folders and moves the syllabus when a destination is selected", () => {
    const onChange = vi.fn();
    render(
      <FolderMoveMenu
        label="Move Climate Policy to folder"
        value="folder-public-affairs"
        onChange={onChange}
        folders={[
          { id: "folder-public-affairs", name: "Public affairs" },
          { id: "folder-climate", name: "Climate courses" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Move Climate Policy to folder" }));

    expect(screen.getByRole("searchbox", { name: "Find a folder" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Public affairs" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a folder" }), { target: { value: "climate" } });
    expect(screen.queryByRole("option", { name: "Public affairs" })).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: "Climate courses" }));
    expect(onChange).toHaveBeenCalledWith("folder-climate");
  });
});
