import { createFolder, createSyllabus, deleteSyllabus, downloadSyllabusExport, getFieldHistory, listSyllabusTemplates, moveSyllabusToFolder } from "./syllabi";
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

  it("lists the approved templates and their editable section structure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "scen-en-v1", name: "SCEN syllabus template (English)", description: "Approved", documentPath: "/syllabi/templates/scen-en-v1/document", sections: [{ id: "identification", label: "1. Course identification" }] }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const templates = await listSyllabusTemplates();

    expect(templates[0]?.id).toBe("scen-en-v1");
    expect(templates[0]?.sections[0]?.id).toBe("identification");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/syllabi\/templates$/), undefined);
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

  it("creates folders, moves syllabi, and deletes syllabi through the library API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "folder-1", name: "Climate courses" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "syllabus-1", folderId: "folder-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await createFolder({ name: "Climate courses", parentId: "folder-programme" });
    await moveSyllabusToFolder("syllabus-1", "folder-1");
    await deleteSyllabus("syllabus-1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/syllabi\/folders$/), expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Climate courses", parentId: "folder-programme" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/syllabus-1\/folder$/), expect.objectContaining({ method: "PATCH" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.stringMatching(/syllabus-1$/), expect.objectContaining({ method: "DELETE" }));
  });
});
