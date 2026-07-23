import { createSyllabus, downloadSyllabusExport, getFieldHistory } from "./syllabi";
import { describe, expect, it, vi } from "vitest";

describe("createSyllabus", () => {
  it("sends a blank syllabus request to the syllabus API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "syllabus-1", courseTitle: "Climate Science" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createSyllabus({ courseTitle: "Climate Science", courseCode: "SCEN-101", academicYear: "2026-2027" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/syllabi$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requests history for one field path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getFieldHistory("syllabus-1", "description.overview");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/syllabus-1\/history\?fieldPath=description.overview$/),
      undefined,
    );
  });

  it("downloads the generated Word syllabus from the export endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["docx"]), { status: 200, headers: { "content-disposition": 'attachment; filename="climate-policy.docx"' } }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:syllabus"), revokeObjectURL: vi.fn() });

    await downloadSyllabusExport("syllabus-1");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/syllabus-1\/export$/));
    expect(click).toHaveBeenCalledOnce();
  });
});
