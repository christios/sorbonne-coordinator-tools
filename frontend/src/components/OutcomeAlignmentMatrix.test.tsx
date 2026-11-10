import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OutcomeAlignmentMatrix, type MatrixPlo } from "@/components/OutcomeAlignmentMatrix";

const PLOS: MatrixPlo[] = [
  { id: "p1", code: "PLO 1", outcome: "Model, analyse and solve simple physics problems involving fundamental physics subjects.", value: "PLO 1: Model, analyse and solve simple physics problems involving fundamental physics subjects." },
  { id: "p2", code: "PLO 2", outcome: "Apply the scientific method.", value: "PLO 2: Apply the scientific method." },
];
const ROWS = [
  { id: "c1", clo: "Trace rays through lenses.", plo: "PLO 1: Model, analyse and solve simple physics problems involving fundamental physics subjects.", ploIds: "p1", skills: "", skillIds: "" },
  { id: "c2", clo: "Measure a focal length.", plo: "PLO 6: Work in teams.", ploIds: "", skills: "", skillIds: "" },
];

function show(onChange?: (rows: typeof ROWS) => void) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><OutcomeAlignmentMatrix rows={ROWS} plos={PLOS} competencyOptions={[]} graduateText={() => ""} onChange={onChange as never} /></QueryClientProvider>);
}

describe("the CLO–PLO alignment matrix", () => {
  it("ticks a CLO's PLOs, flags a PLO no CLO serves, and writes every PLO out in full", () => {
    show(vi.fn());

    expect((screen.getByRole("checkbox", { name: "CLO 1 aligned to PLO 1" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "CLO 1 aligned to PLO 2" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Not yet")).toBeTruthy();
    expect(screen.getByText("Model, analyse and solve simple physics problems involving fundamental physics subjects.")).toBeTruthy();
  });

  it("saves a tick as the PLO's id and its wording, as the document reads them", () => {
    const onChange = vi.fn();
    show(onChange);

    fireEvent.click(screen.getByRole("checkbox", { name: "CLO 1 aligned to PLO 2" }));

    const [rows] = onChange.mock.calls[0];
    expect(rows[0]).toMatchObject({ ploIds: "p1\np2", plo: `${PLOS[0].value}\n${PLOS[1].value}` });
  });

  it("keeps a PLO the curriculum mapping no longer expects until it is removed", () => {
    const onChange = vi.fn();
    show(onChange);

    expect(screen.getByText(/Also aligned to PLO 6: Work in teams/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "CLO 2 aligned to PLO 2" }));
    expect(onChange.mock.calls[0][0][1].plo).toBe(`${PLOS[1].value}\nPLO 6: Work in teams.`);
  });

  it("only shows the alignment where the Head of Department writes the outcomes", () => {
    show(undefined);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByLabelText("CLO 1 aligned to PLO 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add outcome" })).toBeNull();
  });
});
