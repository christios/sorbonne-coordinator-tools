import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RequisitionCourseEditor } from "./RequisitionCourseEditor";

describe("RequisitionCourseEditor", () => {
  it("adds one expanded course card instead of an editable table row", () => {
    const onChange = vi.fn();
    render(<RequisitionCourseEditor courses={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add course" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const courses = onChange.mock.calls[0][0];
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      subjectCode: "",
      courseNumber: "",
      level: "",
      title: "",
      hours: "",
      classType: "",
    });
  });

  it("adds a card before offering the list picker or manual fields", () => {
    render(<RequisitionCourseEditor courses={[]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Add course" })).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Choose from course list" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Import course list")).toBeNull();
  });

  it("keeps complete courses compact until opened", () => {
    render(
      <RequisitionCourseEditor
        courses={[
          {
            id: "mechanics",
            subjectCode: "PHY",
            courseNumber: "101",
            level: "L1",
            title: "Mechanics",
            hours: "24",
            classType: "TD",
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Expand course: Mechanics" }),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Subject code" })).toBeNull();
  });

  it("keeps only one incomplete course card expanded at a time", () => {
    render(
      <RequisitionCourseEditor
        courses={[
          {
            id: "first",
            subjectCode: "",
            courseNumber: "",
            level: "",
            title: "",
            hours: "",
          },
          {
            id: "second",
            subjectCode: "",
            courseNumber: "",
            level: "",
            title: "",
            hours: "",
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("textbox", {
        name: "Course title as per Sorbonne Space",
      }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand course: Untitled course" }),
    );
    expect(
      screen.getAllByRole("textbox", {
        name: "Course title as per Sorbonne Space",
      }),
    ).toHaveLength(1);
  });

  it("marks every manual course field as required and uses the shared level dropdown", () => {
    render(
      <RequisitionCourseEditor
        courses={[
          {
            id: "draft",
            subjectCode: "",
            courseNumber: "",
            level: "",
            title: "",
            hours: "",
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    const title = screen.getByLabelText(
      "Course title as per Sorbonne Space",
    ) as HTMLInputElement;
    const subjectCode = screen.getByLabelText(
      "Subject code",
    ) as HTMLInputElement;
    const courseNumber = screen.getByLabelText(
      "Course number",
    ) as HTMLInputElement;
    const hours = screen.getByLabelText("Hours") as HTMLInputElement;
    const level = screen.getByRole("combobox", { name: "Level" });
    const classType = screen.getByRole("combobox", {
      name: "Course class type",
    });
    expect(title.tagName).toBe("INPUT");
    expect(title.required).toBe(true);
    expect(subjectCode.required).toBe(true);
    expect(courseNumber.required).toBe(true);
    expect(hours.required).toBe(true);
    expect(level.getAttribute("aria-required")).toBe("true");
    expect(classType.getAttribute("aria-required")).toBe("true");
    expect(level.classList.contains("h-10")).toBe(true);
    expect(classType.classList.contains("h-10")).toBe(true);
    expect(classType.classList.contains("w-full")).toBe(true);
  });

  it("adds a snapshot of the selected active catalogue course by CRN", () => {
    const onChange = vi.fn();
    render(
      <RequisitionCourseEditor
        courses={[
          {
            id: "draft",
            subjectCode: "",
            courseNumber: "",
            level: "",
            title: "",
            hours: "",
          },
        ]}
        onChange={onChange}
        catalogueCourses={[
          {
            id: "catalogue-physics",
            crn: "21939",
            term: "262710",
            courseCode: "PHY-101",
            courseTitle: "Physics",
            sequence: "1",
            credit: "4",
            department: "PHY",
            level: "L1",
            college: "P4",
            contactHours: "30",
            isObsolete: false,
            importedAt: "2026-07-24T00:00:00Z",
            obsoleteAt: null,
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "Choose from course list" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Physics — PHY-101" }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "draft",
        catalogCourseId: "catalogue-physics",
        crn: "21939",
        courseCode: "PHY-101",
        subjectCode: "PHY",
        courseNumber: "101",
        title: "Physics",
        hours: "30",
      }),
    ]);
  });

  it("shows only the course title and code in catalogue choices while still matching a code without its dash", () => {
    render(
      <RequisitionCourseEditor
        courses={[
          {
            id: "draft",
            subjectCode: "",
            courseNumber: "",
            level: "",
            title: "",
            hours: "",
          },
        ]}
        onChange={vi.fn()}
        catalogueCourses={[
          {
            id: "catalogue-history",
            crn: "23442",
            term: "262710",
            courseCode: "RMAS-304",
            courseTitle: "A Digital History Grp1",
            sequence: "1",
            credit: "4",
            department: "RMAS",
            level: "L3",
            college: "P4",
            contactHours: "5",
            isObsolete: false,
            importedAt: "2026-07-24T00:00:00Z",
            obsoleteAt: null,
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "Choose from course list" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search Choose from course list" }),
      { target: { value: "rmas 304" } },
    );

    expect(
      screen.getByRole("option", { name: "A Digital History Grp1 — RMAS-304" }),
    ).toBeTruthy();
    expect(screen.queryByText(/CRN 23442/)).toBeNull();
  });

  it("uses an in-app confirmation before removing a course", () => {
    const onChange = vi.fn();
    render(
      <RequisitionCourseEditor
        courses={[
          {
            id: "physics",
            subjectCode: "PHY",
            courseNumber: "101",
            level: "L1",
            title: "Physics",
            hours: "24",
          },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove course: Physics" }),
    );
    expect(screen.getByRole("dialog", { name: "Remove course?" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove course" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
