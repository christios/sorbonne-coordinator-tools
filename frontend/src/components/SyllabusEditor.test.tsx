import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SaveStatus } from "./SyllabusEditor";
import { saveFailureState } from "./syllabusSaveState";

describe("syllabus autosave failures", () => {
  it("identifies the API revision-conflict response instead of treating it as a retryable failure", () => {
    expect(saveFailureState(new Error("This syllabus changed elsewhere. Reload it before saving again."))).toBe("conflict");
    expect(saveFailureState(new Error("Network request failed"))).toBe("error");
  });

  it("keeps a revision conflict deliberate and offers a safe reload action", () => {
    const onReload = vi.fn();
    render(<SaveStatus state="conflict" onReload={onReload} />);

    expect(screen.getByRole("alert").textContent).toContain("updated in another tab");
    screen.getByRole("button", { name: "Reload latest version" }).click();
    expect(onReload).toHaveBeenCalledOnce();
  });
});
