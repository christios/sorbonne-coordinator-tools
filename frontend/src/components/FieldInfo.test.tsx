import { StaffContext } from "@/components/useStaffUser";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { FieldInfoProvider } from "./FieldInfo";
import { FormFieldLabel } from "./FormFieldLabel";

const { listFieldNotes, upsertFieldNote } = vi.hoisted(() => ({
  listFieldNotes: vi.fn().mockResolvedValue([]),
  upsertFieldNote: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/services/workflow", () => ({ listFieldNotes, upsertFieldNote }));

describe("Field information", () => {
  it("opens the editor from the label and reserves the information icon for hover preview", async () => {
    listFieldNotes.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "note-1",
        resourceType: "teacher",
        resourceId: "teacher-1",
        fieldKey: "email",
        content: "Use the university address.",
        createdAt: "2026-08-21T00:00:00Z",
        updatedAt: "2026-08-21T00:00:00Z",
      },
    ]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StaffContext.Provider value={{ email: "a@b.c", name: "Admin", isAdmin: true }}><FieldInfoProvider
          source={{ resourceType: "teacher", resourceId: "teacher-1" }}
        >
          <FormFieldLabel fieldKey="email">Email</FormFieldLabel>
        </FieldInfoProvider></StaffContext.Provider>
      </QueryClientProvider>,
    );

    await vi.waitFor(() => expect(listFieldNotes).toHaveBeenCalled());
    expect(
      screen.queryByRole("img", { name: "Field information for Email" }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText("Email"));
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Field information text" }),
      { target: { value: "Use the university address." } },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save information" }));
    });

    await vi.waitFor(() =>
      expect(upsertFieldNote).toHaveBeenCalledWith({
        resourceType: "teacher",
        resourceId: "teacher-1",
        fieldKey: "email",
        content: "Use the university address.",
      }),
    );
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Field information" }),
      ).toBeNull(),
    );
    const icon = await screen.findByRole("img", {
      name: "Field information for Email",
    });
    fireEvent.mouseEnter(icon);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Use the university address.",
    );
    fireEvent.click(icon);
    expect(
      screen.queryByRole("dialog", { name: "Field information" }),
    ).toBeNull();
  });

  it("renders its editor in a document-level layer so an editor canvas cannot clip it", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StaffContext.Provider value={{ email: "a@b.c", name: "Admin", isAdmin: true }}><FieldInfoProvider
          source={{
            resourceType: "teacher-requisition",
            resourceId: "request-1",
          }}
        >
          <div className="overflow-hidden">
            <FormFieldLabel fieldKey="courses.course-1.course-number">
              Course number
            </FormFieldLabel>
          </div>
        </FieldInfoProvider></StaffContext.Provider>
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Course number"));
    });

    const dialog = screen.getByRole("dialog", {
      name: "Field information",
    });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain("fixed");
  });
});

describe("Field information for a reader", () => {
  it("shows the guidance without offering to change it", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <StaffContext.Provider value={{ email: "prof@suad.ae", name: "Professor", isAdmin: false }}>
          <FieldInfoProvider source={{ resourceType: "syllabus-field", resourceId: "shared" }}>
            <FormFieldLabel fieldKey="identification.ects">Number of ECTS</FormFieldLabel>
          </FieldInfoProvider>
        </StaffContext.Provider>
      </QueryClientProvider>,
    );

    // Everyone can read guidance; only an administrator writes it.
    expect(screen.queryByRole("textbox", { name: "Field information text" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save information/ })).toBeNull();
  });
});
