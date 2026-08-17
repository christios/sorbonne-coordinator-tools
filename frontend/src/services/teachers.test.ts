import { describe, expect, it, vi } from "vitest";

import { createTeacher, createTeacherRequisition, moveTeacherToFolder } from "./teachers";

describe("teacher service", () => {
  it("creates teachers, moves them to folders, and adds labelled requisitions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "teacher-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "teacher-1", folderId: "folder-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "request-1" }), { status: 201 }));

    await createTeacher({ fullName: "Dr Amira Example", email: "", phone: "", notes: "" });
    await moveTeacherToFolder("teacher-1", "folder-1");
    await createTeacherRequisition("teacher-1", { label: "Physics TD contract", academicYear: "2026-2027" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/teachers$/), expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/teachers\/teacher-1\/folder$/), expect.objectContaining({ method: "PATCH" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.stringMatching(/teachers\/teacher-1\/requisitions$/), expect.objectContaining({ method: "POST", body: JSON.stringify({ label: "Physics TD contract", academicYear: "2026-2027" }) }));
    fetchMock.mockRestore();
  });
});
