import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyllabusLibrary } from "./SyllabusLibrary";

describe("SyllabusLibrary", () => {
  it("opens public catalogue management from the library header", () => {
    const onManageCatalogues = vi.fn();
    render(<SyllabusLibrary syllabi={[]} folders={[]} templates={[]} isLoading={false} isCreating={false} isCreatingFolder={false} deletingId={null} deletingFolderId={null} movingId={null} onOpen={vi.fn()} onCreate={vi.fn()} onCreateFolder={vi.fn()} onMove={vi.fn()} onManageCatalogues={onManageCatalogues} onDelete={vi.fn()} onDeleteFolder={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Manage catalogues" }));

    expect(onManageCatalogues).toHaveBeenCalledOnce();
  });

  it("filters folders and syllabi within the selected folder", async () => {
    const onOpen = vi.fn();
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <SyllabusLibrary
        syllabi={[
          { id: "syllabus-1", seriesId: "series-1", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Policy", courseCode: "SCEN-220", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-20T08:05:00", updatedAt: "2026-07-22T09:05:00" },
          { id: "syllabus-2", seriesId: "series-2", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Law", courseCode: "SCEN-221", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
          { id: "syllabus-3", seriesId: "series-3", folderId: null, templateId: "scen-en-v1", courseTitle: "Environmental Law", courseCode: "SCEN-240", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" },
        ]}
        folders={[
          { id: "folder-1", name: "Climate courses", parentId: "folder-0", createdAt: "", updatedAt: "" },
          { id: "folder-0", name: "Public affairs", parentId: null, createdAt: "", updatedAt: "" },
          { id: "folder-2", name: "Archived courses", parentId: null, createdAt: "", updatedAt: "" },
        ]}
        templates={[{ id: "scen-en-v1", name: "SCEN syllabus template (English)", description: "Approved English template", documentPath: "/syllabi/templates/scen-en-v1/document", sections: [{ id: "identification", label: "1. Course identification" }] }]}
        isLoading={false}
        isCreating={false}
        isCreatingFolder={false}
        deletingId={null}
        deletingFolderId={null}
        movingId={null}
        onOpen={onOpen}
        onCreate={vi.fn()}
        onCreateFolder={vi.fn()}
        onMove={vi.fn()}
        onRename={onRename}
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
    expect(screen.getByLabelText("Folder path for Climate Policy").textContent).toContain("Public affairs");
    expect(screen.getByLabelText("Folder path for Climate Policy").textContent).toContain("Climate courses");
    expect(screen.getByLabelText("Academic year: 2026-2027")).toBeTruthy();
    expect(screen.getByLabelText("Course code: SCEN-220")).toBeTruthy();
    expect(screen.getByText("Created: 20 Jul 2026, 08:05")).toBeTruthy();
    expect(screen.getByText("Updated: 22 Jul 2026, 09:05")).toBeTruthy();
    expect(screen.queryByText("Revision 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Climate Policy" }));
    expect(onOpen).toHaveBeenCalledWith("syllabus-1");

    fireEvent.click(screen.getByRole("button", { name: "Rename Climate Policy" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Syllabus title for Climate Policy" }), { target: { value: "Climate Action" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Syllabus title for Climate Policy" }), { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("syllabus-1", "Climate Action"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Syllabus title for Climate Policy" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Climate Policy" }));
    expect(screen.getByText("Start a syllabus")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duplicate and edit" })).toBeTruthy();
    expect(screen.getByText("Choose a mapped template, such as Foundation Year, to carry comparable content into a new syllabus in the same series.")).toBeTruthy();
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
          { id: "folder-1", name: "Climate courses", parentId: null, createdAt: "", updatedAt: "" },
          { id: "folder-2", name: "Empty archive", parentId: null, createdAt: "", updatedAt: "" },
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

  it("creates a subfolder in the selected folder and hides an empty Unfiled filter", () => {
    const onCreateFolder = vi.fn();
    render(
      <SyllabusLibrary
        syllabi={[{ id: "syllabus-1", seriesId: "series-1", folderId: "folder-1", templateId: "scen-en-v1", courseTitle: "Climate Policy", courseCode: "SCEN-220", academicYear: "2026-2027", revision: 1, createdAt: "", updatedAt: "" }]}
        folders={[{ id: "folder-1", name: "Programme", parentId: null, createdAt: "", updatedAt: "" }]}
        templates={[{ id: "scen-en-v1", name: "SCEN syllabus template (English)", description: "Approved English template", documentPath: "/syllabi/templates/scen-en-v1/document", sections: [] }]}
        isLoading={false}
        isCreating={false}
        isCreatingFolder={false}
        deletingId={null}
        deletingFolderId={null}
        movingId={null}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onCreateFolder={onCreateFolder}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Unfiled" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Programme" }));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Folder name/ }), { target: { value: "Year 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(onCreateFolder).toHaveBeenCalledWith({ name: "Year 3", parentId: "folder-1" });
  });
});
