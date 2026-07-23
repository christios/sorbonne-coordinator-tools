import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyllabusLibrary } from "./SyllabusLibrary";

describe("SyllabusLibrary", () => {
  it("filters by folder and confirms before deleting a syllabus", () => {
    const onDelete = vi.fn();
    render(
      <SyllabusLibrary
        syllabi={[
          { id: "syllabus-1", seriesId: "series-1", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Policy", courseCode: "SCEN-220", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
          { id: "syllabus-2", seriesId: "series-2", folderId: null, templateId: "scen-en-v1", courseTitle: "Environmental Law", courseCode: "SCEN-240", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
        ]}
        folders={[{ id: "folder-1", name: "Climate courses", createdAt: "", updatedAt: "" }]}
        templates={[{ id: "scen-en-v1", name: "SCEN syllabus template (English)", description: "Approved English template", documentPath: "/syllabi/templates/scen-en-v1/document", sections: [{ id: "identification", label: "1. Course identification" }] }]}
        isLoading={false}
        isCreating={false}
        isCreatingFolder={false}
        deletingId={null}
        movingId={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onCreateFolder={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Climate courses" }));
    expect(screen.getByText("Climate Policy")).toBeTruthy();
    expect(screen.queryByText("Environmental Law")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete Climate Policy" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete syllabus" }));
    expect(onDelete).toHaveBeenCalledWith("syllabus-1");
  });
});
