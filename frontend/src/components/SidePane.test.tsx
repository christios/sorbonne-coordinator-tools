import { fireEvent, render, screen, within } from "@testing-library/react";
import { BookMarked, Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { SidePane } from "@/components/SidePane";

const ITEMS = [
  { id: "students", name: "Students", icon: Users, group: "Portal validation" },
  { id: "active-courses", name: "Active CRNs", icon: BookMarked, group: "Portal validation", parent: "courses" },
];

describe("the page menu on a phone", () => {
  it("says which page this is, opens as a drawer, and closes on the page chosen", () => {
    const onSelect = vi.fn();
    render(<SidePane label="Pages" heading="Students and timetables" items={ITEMS} activeId="students" onSelect={onSelect} />);

    const opener = screen.getByRole("button", { name: "Open the Students and timetables menu" });
    expect(opener.textContent).toBe("Students");
    fireEvent.click(opener);

    const drawer = screen.getByRole("dialog", { name: "Pages" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Active CRNs" }));

    expect(onSelect).toHaveBeenCalledWith("active-courses");
    expect(screen.queryByRole("dialog", { name: "Pages" })).toBeNull();
  });

  it("closes on Escape without choosing anything", () => {
    const onSelect = vi.fn();
    render(<SidePane label="Pages" heading="Students and timetables" items={ITEMS} activeId="students" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Open the Students and timetables menu" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Pages" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
