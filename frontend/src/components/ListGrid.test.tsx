import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("picking columns from their headings", () => {
  /*
   * The presets' copy without naming a preset. A checkbox sits on every heading; tick one
   * and the rest show, tick the ones wanted, copy. The same rows as a preset — the ticked
   * ones, or everything shown — and the columns in the order the table shows them, not
   * the order they were ticked in.
   */
  const clipboard = () => {
    const written: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: (text: string) => (written.push(text), Promise.resolve()) } });
    return written;
  };
  const pick = (name: string) => fireEvent.click(screen.getByLabelText(`Pick the ${name} column to copy`));

  it("shows the bar once a column is ticked, and copies the ticked columns in table order", async () => {
    const written = clipboard();
    show();
    expect(screen.queryByLabelText("Columns picked to copy")).toBeNull();

    pick("Teacher");
    pick("Course");

    const bar = screen.getByLabelText("Columns picked to copy");
    expect(bar.textContent).toContain("Course, Teacher");
    fireEvent.click(within(bar).getByRole("button", { name: "Copy the 2 picked columns" }));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0].split("\n").map((line) => line.split("\t"))).toEqual([
      ["Course", "Teacher"],
      ["MATH-001", "Dr Maaz"],
      ["SCEN-101", "Mme Bendjaballah"],
      ["MATH-011", "Dr Ahmed"],
    ]);
  });

  it("copies only the selected rows when some are, like a preset does", async () => {
    const written = clipboard();
    show();
    fireEvent.click(screen.getByLabelText("Select MATH-011"));
    pick("CRN");

    const bar = screen.getByLabelText("Columns picked to copy");
    expect(bar.textContent).toContain("1 selected row");
    fireEvent.click(within(bar).getByRole("button", { name: "Copy the 1 picked column" }));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe("CRN\n23652");
  });

  it("is done with Done, or with Escape", () => {
    show();
    pick("CRN");
    fireEvent.click(within(screen.getByLabelText("Columns picked to copy")).getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Columns picked to copy")).toBeNull();
    expect((screen.getByLabelText("Pick the CRN column to copy") as HTMLInputElement).checked).toBe(false);

    pick("CRN");
    fireEvent.keyDown(screen.getByLabelText("Pick the CRN column to copy"), { key: "Escape" });
    expect(screen.queryByLabelText("Columns picked to copy")).toBeNull();
  });
});
