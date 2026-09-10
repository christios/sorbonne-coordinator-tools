import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListGrid } from "@/components/ListGrid";
import type { GridColumn } from "@/services/studentColumns";

type Course = { crn: string; code: string; teacher: string; registered: number };

const COLUMNS: GridColumn<Course>[] = [
  { id: "crn", displayName: "CRN", type: "text", accessor: (row) => row.crn, required: true, defaultWidth: 90 },
  { id: "code", displayName: "Course", type: "text", accessor: (row) => row.code, required: true, defaultWidth: 120 },
  { id: "teacher", displayName: "Teacher", type: "option", accessor: (row) => row.teacher, defaultWidth: 160 },
  { id: "registered", displayName: "Registered", type: "number", accessor: (row) => row.registered, defaultWidth: 90 },
];
const ROWS: Course[] = [
  { crn: "22151", code: "MATH-001", teacher: "Dr Maaz", registered: 30 },
  { crn: "23652", code: "MATH-011", teacher: "Dr Ahmed", registered: 12 },
  { crn: "23302", code: "SCEN-101", teacher: "Mme Bendjaballah", registered: 14 },
];

function show(extra: Partial<Parameters<typeof ListGrid<Course>>[0]> = {}) {
  return render(
    <ListGrid
      columns={COLUMNS}
      rows={ROWS}
      idOf={(row) => row.crn}
      labelOf={(row) => row.code}
      layoutKey="test-layout"
      presetKey="test-presets"
      shown={["crn", "code", "teacher"]}
      noun="courses"
      empty="Nothing"
      {...extra}
    />,
  );
}

const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row").filter((row) => row.hasAttribute("data-row-id"));
const firstCells = () => bodyRows().map((row) => row.getAttribute("data-row-id"));

describe("a list on the shared table", () => {
  it("shows the default columns and keeps the rest in the column picker", () => {
    show();

    expect(screen.getByRole("button", { name: "Sort by Teacher" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sort by Registered" })).toBeNull();
    expect(screen.getByText("3 courses")).toBeTruthy();
  });

  it("sorts by a heading, searches every shown column, and reports what is shown", () => {
    show();

    fireEvent.click(screen.getByRole("button", { name: "Sort by Course" }));
    expect(firstCells()).toEqual(["22151", "23652", "23302"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Course" }));
    expect(firstCells()).toEqual(["23302", "23652", "22151"]);

    fireEvent.change(screen.getByLabelText("Search every column"), { target: { value: "ahmed" } });
    expect(firstCells()).toEqual(["23652"]);
    expect(screen.getByText("3 courses, 1 shown")).toBeTruthy();
  });

  it("opens the row on a click anywhere but a control", () => {
    const onRowClick = vi.fn();
    show({ onRowClick } as never);

    fireEvent.click(screen.getByText("MATH-011"));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);

    onRowClick.mockClear();
    fireEvent.click(screen.getByLabelText("Select MATH-011"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("hands the selection to the page", () => {
    const onSelectedChange = vi.fn();
    show({ selected: new Set(), onSelectedChange });

    fireEvent.click(screen.getByLabelText("Select MATH-011"));

    expect(onSelectedChange).toHaveBeenCalledWith(new Set(["23652"]));
  });
});
