import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PayRatesPanel } from "@/components/PayRatesPanel";
import * as payRates from "@/services/payRates";

const YEAR = payRates.academicYearOf(new Date());

function show(canChange = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PayRatesPanel canChange={canChange} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("the department's pay rates", () => {
  it("shows this year's table, an empty cell being work that degree is not paid for", async () => {
    vi.spyOn(payRates, "fetchPayRates").mockResolvedValue({ [YEAR]: { phd: { CM: 500, "TD-TP": 350, OTHER: 100 }, bachelors: { "TD-TP": 150, OTHER: 100 } } });
    show();

    await waitFor(() => expect((screen.getByLabelText("PhD CM rate") as HTMLInputElement).value).toBe("500"));
    expect((screen.getByLabelText("Bachelors TD/TP rate") as HTMLInputElement).value).toBe("150");
    expect((screen.getByLabelText("Bachelors CM rate") as HTMLInputElement).value).toBe("");
  });

  it("saves the year as typed, leaving empty cells out", async () => {
    vi.spyOn(payRates, "fetchPayRates").mockResolvedValue({});
    const save = vi.spyOn(payRates, "setYearRates").mockResolvedValue({});
    show();

    expect(await screen.findByText(`No rates for ${YEAR} yet: its sheets go out with the rate blank.`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Masters CM rate"), { target: { value: "350" } });
    fireEvent.change(screen.getByLabelText("Masters TD/TP rate"), { target: { value: "350" } });
    fireEvent.change(screen.getByLabelText("Bachelors TD/TP rate"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: `Save ${YEAR}` }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(YEAR, { masters: { CM: 350, "TD-TP": 350 }, bachelors: { "TD-TP": 150 } }),
    );
  });

  it("refuses a rate that is not a number of dirhams, and saves nothing", async () => {
    vi.spyOn(payRates, "fetchPayRates").mockResolvedValue({});
    const save = vi.spyOn(payRates, "setYearRates").mockResolvedValue({});
    show();

    await screen.findByText(/No rates for/);
    fireEvent.change(screen.getByLabelText("PhD CM rate"), { target: { value: "-5" } });

    expect(screen.getByText(/PhD CM: a rate is a number of dirhams/)).toBeTruthy();
    expect(screen.getByRole("button", { name: `Save ${YEAR}` })).toHaveProperty("disabled", true);
    expect(save).not.toHaveBeenCalled();
  });

  it("is read by everybody and changed only by an administrator", async () => {
    vi.spyOn(payRates, "fetchPayRates").mockResolvedValue({ [YEAR]: { phd: { CM: 500 } } });
    show(false);

    await waitFor(() => expect((screen.getByLabelText("PhD CM rate") as HTMLInputElement).value).toBe("500"));
    expect(screen.getByLabelText("PhD CM rate")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});
