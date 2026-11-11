import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OutcomeAlignmentMatrix, type MatrixCompetency, type MatrixGraduate, type MatrixPlo } from "@/components/OutcomeAlignmentMatrix";

const PLOS: MatrixPlo[] = [
  { id: "p1", code: "PLO 1", outcome: "Model, analyse and solve simple physics problems involving fundamental physics subjects.", value: "PLO 1: Model, analyse and solve simple physics problems involving fundamental physics subjects." },
  { id: "p2", code: "PLO 2", outcome: "Apply the scientific method.", value: "PLO 2: Apply the scientific method." },
];
const COMPETENCIES: MatrixCompetency[] = [
  { id: "competency-1", code: "SCEN-C1", outcome: "Applies knowledge.", value: "SCEN-C1: Applies knowledge.", graduateIds: ["g1"] },
  { id: "competency-2", code: "SCEN-C2", outcome: "Uses mathematical reasoning.", value: "SCEN-C2: Uses mathematical reasoning.", graduateIds: ["g1", "g3", "g7"] },
];
const GRADUATES: MatrixGraduate[] = [
  { id: "g1", code: "GradComp 1", outcome: "Autonomy" },
  { id: "g3", code: "GradComp 3", outcome: "Decision making" },
  { id: "g5", code: "GradComp 5", outcome: "Communication" },
  { id: "g7", code: "GradComp 7", outcome: "Digital literacy" },
];
const ROWS = [
  { id: "c1", clo: "Trace rays through lenses.", plo: "PLO 1: Model, analyse and solve simple physics problems involving fundamental physics subjects.", ploIds: "p1", skills: "", skillIds: "" },
  { id: "c2", clo: "Measure a focal length.", plo: "PLO 6: Work in teams.", ploIds: "", skills: "", skillIds: "" },
];

function show(onChange?: (rows: typeof ROWS) => void) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><OutcomeAlignmentMatrix rows={ROWS} plos={PLOS} competencies={COMPETENCIES} graduates={GRADUATES} onChange={onChange as never} /></QueryClientProvider>);
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

  it("in Head-of-Department mode, leaves the teacher only the competencies to choose", () => {
    const onCompetenciesChange = vi.fn();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><OutcomeAlignmentMatrix rows={ROWS} plos={PLOS} competencies={COMPETENCIES} graduates={GRADUATES} onCompetenciesChange={onCompetenciesChange} /></QueryClientProvider>);

    // The outcomes and their PLOs are the Head of Department's: no box, no PLO tick, no add.
    expect(screen.queryByRole("textbox", { name: /CLO 1/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /aligned to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add outcome" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "CLO 1 develops SCEN-C1" }));
    // Stored by the Head of Department's CLO id, as competency ids.
    expect(onCompetenciesChange).toHaveBeenCalledWith("c1", ["competency-1"]);
  });

  it("saves a competency tick as its id and wording, in the catalogue's order", () => {
    const onChange = vi.fn();
    const client = new QueryClient();
    const rows = [{ ...ROWS[0], skills: "SCEN-C2: Uses mathematical reasoning.", skillIds: "competency-2" }];
    render(<QueryClientProvider client={client}><OutcomeAlignmentMatrix rows={rows} plos={PLOS} competencies={COMPETENCIES} graduates={GRADUATES} onChange={onChange} /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("checkbox", { name: "CLO 1 develops SCEN-C1" }));

    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      skillIds: "competency-1\ncompetency-2",
      skills: "SCEN-C1: Applies knowledge.\nSCEN-C2: Uses mathematical reasoning.",
    });
  });

  it("lights up every SUAD graduate competency a SCEN competency brings, not only the first", () => {
    const client = new QueryClient();
    // An older CLO, its competency stored by wording only.
    const rows = [{ ...ROWS[0], skills: "SCEN-C2: Uses mathematical reasoning.", skillIds: "" }, ROWS[1]];
    render(<QueryClientProvider client={client}><OutcomeAlignmentMatrix rows={rows} plos={PLOS} competencies={COMPETENCIES} graduates={GRADUATES} onChange={vi.fn()} /></QueryClientProvider>);

    expect(screen.getByLabelText("CLO 1 develops GradComp 1, through SCEN-C2")).toBeTruthy();
    expect(screen.getByLabelText("CLO 1 develops GradComp 3, through SCEN-C2")).toBeTruthy();
    expect(screen.getByLabelText("CLO 1 develops GradComp 7, through SCEN-C2")).toBeTruthy();
    expect(screen.queryByLabelText(/CLO 1 develops GradComp 5/)).toBeNull();
    // A CLO with none yet is asked for one, where its SUAD competencies would be.
    expect(screen.getByText("Tick at least one SCEN competency")).toBeTruthy();

    // The panel gives each SUAD competency in full, with the CLOs developing it and through what.
    fireEvent.click(screen.getByRole("tab", { name: "SUAD" }));
    const decision = screen.getByText("Decision making").closest("li") as HTMLElement;
    expect(decision.textContent).toContain("CLO 1");
    expect(decision.textContent).toContain("SCEN-C2");
  });

  it("shows one table at a time in tabs, each saying what is still to do in it", () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><OutcomeAlignmentMatrix rows={ROWS} plos={PLOS} competencies={COMPETENCIES} graduates={GRADUATES} onChange={vi.fn()} view="tabs" /></QueryClientProvider>);

    // PLO alignment first: its ticks, not the competencies'.
    expect(screen.getByRole("checkbox", { name: "CLO 1 aligned to PLO 1" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "CLO 1 develops SCEN-C1" })).toBeNull();
    expect(screen.getByLabelText("2 CLOs without a competency")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Competencies/ }));

    expect(screen.getByRole("checkbox", { name: "CLO 1 develops SCEN-C1" })).toBeTruthy();
    // Each outcome in full beside its ticks, not cut short.
    const competencyTable = screen.getByRole("region", { name: "Competencies each outcome develops" });
    expect(competencyTable.textContent).toContain("CLO 1 Trace rays through lenses.");
    expect(competencyTable.querySelector(".truncate, [class*='line-clamp']")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "CLO 1 aligned to PLO 1" })).toBeNull();
    // The panel beside it turns to the SCEN competencies.
    expect(screen.getByRole("tab", { name: "SCEN" }).getAttribute("aria-selected")).toBe("true");
  });
});
