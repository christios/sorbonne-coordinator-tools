import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyllabusLibrary } from "./SyllabusLibrary";

describe("SyllabusLibrary", () => {
  it("filters folders and syllabi within the selected folder", () => {
    render(
      <SyllabusLibrary
        syllabi={[
          { id: "syllabus-1", seriesId: "series-1", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Policy", courseCode: "SCEN-220", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
          { id: "syllabus-2", seriesId: "series-2", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Law", courseCode: "SCEN-221", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
          { id: "syllabus-3", seriesId: "series-3", folderId: null, templateId: "scen-en-v1", courseTitle: "Environmental Law", courseCode: "SCEN-240", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
        ]}
        folders={[
          { id: "folder-1", name: "Climate courses", createdAt: "", updatedAt: "" },
          { id: "folder-2", name: "Archived courses", createdAt: "", updatedAt: "" },
        ]}
        templates={[{ id: "scen-en-v1", name: "SCEN syllabus template (English)", description: "Approved English template", documentPath: "/syllabi/templates/scen-en-v1/document", sections: [{ id: "identification", label: "1. Course identification" }] }]}
        isLoading={false}
        isCreating={false}
        isCreatingFolder={false}
        deletingId={null}
        deletingFolderId={null}
        movingId={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onCreateFolder={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search folders" }), { target: { value: "arch" } });
    expect(screen.getByRole("button", { name: "Archived courses" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Climate courses" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search folders" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Climate courses" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search syllabi in Climate courses" }), { target: { value: "policy" } });
    expect(screen.getByText("Climate Policy")).toBeTruthy();
    expect(screen.queryByText("Climate Law")).toBeNull();
    expect(screen.queryByText("Environmental Law")).toBeNull();
  });

  it("confirms deletion for empty folders and protects populated folders", () => {
    const onDelete = vi.fn();
    const onDeleteFolder = vi.fn();
    render(
      <SyllabusLibrary
        syllabi={[
          { id: "syllabus-1", seriesId: "series-1", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Policy", courseCode: "SCEN-220", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
          { id: "syllabus-2", seriesId: "series-2", folderId: null, templateId: "scen-en-v1", courseTitle: "Environmental Law", courseCode: "SCEN-240", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
        ]}
        folders={[
          { id: "folder-1", name: "Climate courses", createdAt: "", updatedAt: "" },
          { id: "folder-2", name: "Empty archive", createdAt: "", updatedAt: "" },
        ]}
        templates={[{ id: "scen-en-v1", name: "SCEN syllabus template (English)", description: "Approved English template", documentPath: "/syllabi/templates/scen-en-v1/document", sections: [{ id: "identification", label: "1. Course identification" }] }]}
        isLoading={false}
        isCreating={false}
        isCreatingFolder={false}
        deletingId={null}
        deletingFolderId={null}
        movingId={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onCreateFolder={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
        onDeleteFolder={onDeleteFolder}
      />,
    );

    expect(screen.getByRole("button", { name: "Delete folder Climate courses" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete folder Empty archive" }));
    expect(screen.getByRole("alertdialog", { name: "Delete folder?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    expect(onDeleteFolder).toHaveBeenCalledWith("folder-2");

    fireEvent.click(screen.getByRole("button", { name: "Delete Climate Policy" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete syllabus" }));
    expect(onDelete).toHaveBeenCalledWith("syllabus-1");
  });
});
