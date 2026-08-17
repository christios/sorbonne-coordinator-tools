import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LibraryRecordTimestamps } from "./LibraryRecordTimestamps";

describe("LibraryRecordTimestamps", () => {
  it("shows the creation date and a relative recent update time", () => {
    render(
      <LibraryRecordTimestamps
        createdAt="2026-07-20T08:05:00"
        updatedAt="2026-07-24T09:05:00"
        now={new Date("2026-07-24T10:05:00")}
      />,
    );

    expect(screen.getByText("Created: 20 Jul 2026, 08:05").querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Updated: 1 hour ago").querySelector("svg")).not.toBeNull();
  });

  it("shows the full date and time for older updates", () => {
    render(
      <LibraryRecordTimestamps
        createdAt="2026-07-20T08:05:00"
        updatedAt="2026-07-22T09:05:00"
        now={new Date("2026-07-24T10:05:00")}
      />,
    );

    expect(screen.getByText("Updated: 22 Jul 2026, 09:05")).toBeTruthy();
  });
});
