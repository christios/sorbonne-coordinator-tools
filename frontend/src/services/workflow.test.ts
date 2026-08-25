import { describe, expect, it, vi } from "vitest";

import { listTasks } from "./workflow";

describe("workflow service", () => {
  it("includes the staff session cookie when loading tasks", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );

    await listTasks("teacher", "teacher-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/tasks\?resourceType=teacher&resourceId=teacher-1$/),
      expect.objectContaining({ credentials: "include" }),
    );
    fetchMock.mockRestore();
  });
});
