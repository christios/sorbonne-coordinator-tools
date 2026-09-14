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
          source={{ resourceType: "teacher", resourceId: "teacher-1", app: "teachers" }}
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
            app: "teachers",
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
          <FieldInfoProvider source={{ resourceType: "syllabus-field", resourceId: "shared", app: "syllabus" }}>
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

describe("Who may write a field's guidance", () => {
  const guidance = {
    id: "note-1",
    resourceType: "syllabus-field",
    resourceId: "shared",
    fieldKey: "identification.ects",
    content: "Credits come from the course record.",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };

  function renderLabel(user: { email: string; name: string; isAdmin: boolean; apps?: Record<string, "admin" | "member"> }) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StaffContext.Provider value={user}>
          <FieldInfoProvider source={{ resourceType: "syllabus-field", resourceId: "shared", app: "syllabus" }}>
            <FormFieldLabel fieldKey="identification.ects">Number of ECTS</FormFieldLabel>
          </FieldInfoProvider>
        </StaffContext.Provider>
      </QueryClientProvider>,
    );
  }

  it("is whoever administers the app, who need not administer the platform", async () => {
    listFieldNotes.mockReset();
    listFieldNotes.mockResolvedValue([]);
    renderLabel({ email: "chair@sorbonne.ae", name: "Chair", isAdmin: false, apps: { syllabus: "admin" } });

    await vi.waitFor(() => expect(listFieldNotes).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByText("Number of ECTS"));
    });

    expect(screen.getByRole("textbox", { name: "Field information text" })).toBeTruthy();
  });

  it("is not whoever only fills the form in, who reads it and is not invited to change it", async () => {
    listFieldNotes.mockReset();
    listFieldNotes.mockResolvedValue([guidance]);
    renderLabel({ email: "prof@sorbonne.ae", name: "Professor", isAdmin: false, apps: { syllabus: "member" } });

    // The icon appears only once the guidance has arrived, so waiting for it waits for that.
    await screen.findByRole("img", { name: "Field information for Number of ECTS" });
    await act(async () => {
      fireEvent.click(screen.getByText("Number of ECTS"));
    });

    expect(screen.queryByRole("textbox", { name: "Field information text" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save information" })).toBeNull();
    expect(screen.getByText("Credits come from the course record.")).toBeTruthy();
  });

  it("leaves the label alone for somebody who can neither write guidance nor read any", async () => {
    listFieldNotes.mockReset();
    listFieldNotes.mockResolvedValue([]);
    renderLabel({ email: "prof@sorbonne.ae", name: "Professor", isAdmin: false, apps: { syllabus: "member" } });

    await vi.waitFor(() => expect(listFieldNotes).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByText("Number of ECTS"));
    });

    expect(screen.queryByRole("dialog", { name: "Field information" })).toBeNull();
  });
});
