import { describe, expect, it } from "vitest";

import { handbookUrl } from "@/routes/handbookRoute";

describe("handbookUrl", () => {
  it("opens the local MkDocs server from the Vite development app", () => {
    expect(handbookUrl("127.0.0.1", "http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000/");
    expect(handbookUrl("localhost", "http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000/");
  });

  it("uses the integrated handbook route in deployed environments", () => {
    expect(handbookUrl("sorbonne-coordinator-tools.fastapicloud.dev")).toBe("/handbook/");
  });
});
