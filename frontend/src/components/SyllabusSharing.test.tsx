import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SyllabusSharing } from "@/components/SyllabusSharing";
import * as syllabi from "@/services/syllabi";

vi.mock("@/components/useStaffUser", () => ({ useStaffUser: () => ({ email: "professor@sorbonne.ae", name: "A Professor", isAdmin: false }) }));

const SYLLABUS: syllabi.Syllabus = {
  id: "syl-1", seriesId: "series-1", folderId: null, templateId: "scen-2025-26", courseTitle: "Optics", courseCode: "PHYS-118",
  academicYear: "2026-2027", revision: 3, createdAt: "", updatedAt: "", ownerEmail: "professor@sorbonne.ae",
  visibility: "private", submittedAt: null, content: {},
};
const SECTIONS = [
  { id: "description", label: "3. Course description and delivery" },
  { id: "schedule", label: "5. Course schedule" },
];

function show(syllabus: syllabi.Syllabus, onOpenSection = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SyllabusSharing syllabus={syllabus} sections={SECTIONS} onOpenSection={onOpenSection} />
    </QueryClientProvider>,
  );
  return onOpenSection;
}

afterEach(() => vi.restoreAllMocks());

describe("submitting a syllabus for review", () => {
  it("lists what is still to fill in, by section, in place of the button", async () => {
    vi.spyOn(syllabi, "getSyllabusCompleteness").mockResolvedValue({
      complete: false,
      missing: [
        { section: "description", message: "Write the course description." },
        { section: "schedule", message: 'Give "Essay" a week.' },
        { section: "schedule", message: "Make the graded activities' weights add up to 100% (they add up to 40%)." },
      ],
    });
    const onOpenSection = show(SYLLABUS);

    fireEvent.click(await screen.findByRole("button", { name: "3 to fill in before review" }));

    expect(screen.queryByRole("button", { name: /Submit for review/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "5. Course schedule" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: 'Give "Essay" a week.' }));
    expect(onOpenSection).toHaveBeenCalledWith("schedule");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Submit for review once nothing is missing", async () => {
    vi.spyOn(syllabi, "getSyllabusCompleteness").mockResolvedValue({ complete: true, missing: [] });
    const submit = vi.spyOn(syllabi, "setSyllabusReview").mockResolvedValue({ ...SYLLABUS, submittedAt: "2026-11-10T10:00:00Z" });
    show(SYLLABUS);

    const button = await screen.findByRole("button", { name: /Submit for review/ });
    await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("syl-1", true));
  });

  it("always lets its author withdraw a request, without asking what is missing", async () => {
    const asked = vi.spyOn(syllabi, "getSyllabusCompleteness");
    show({ ...SYLLABUS, submittedAt: "2026-11-10T10:00:00Z" });

    expect((screen.getByRole("button", { name: /Withdraw from review/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(asked).not.toHaveBeenCalled();
  });

  it("shows why the server refused, if something went missing since the list was asked", async () => {
    vi.spyOn(syllabi, "getSyllabusCompleteness").mockResolvedValue({ complete: true, missing: [] });
    vi.spyOn(syllabi, "setSyllabusReview").mockRejectedValue(new Error("This syllabus is not ready for review: 1 thing still to fill in."));
    show(SYLLABUS);

    const button = await screen.findByRole("button", { name: /Submit for review/ });
    await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain("not ready for review");
  });
});
