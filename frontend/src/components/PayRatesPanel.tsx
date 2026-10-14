/**
 * The department's pay rates for part-timers, one academic year at a time: a row per
 * degree, a column per Part Time Sheet. Every sheet is paid at its teacher's degree's rate
 * for the year its period opens in, so a year's table is kept when the next one is added.
 *
 * An empty cell is work that degree is not paid for — a Bachelors gives no lectures — and a
 * sheet that needs it goes out with no rate and a warning.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import {
  academicYearOf,
  DEGREE_WORDS,
  DEGREES,
  fetchPayRates,
  RATE_SHEETS,
  setYearRates,
  type YearRates,
} from "@/services/payRates";
import { SHEET_WORDS, type Degree, type PartTimeSheetType } from "@/services/teachers";

type Typed = Record<Degree, Record<PartTimeSheetType, string>>;

const typedFrom = (year: YearRates | undefined): Typed =>
  Object.fromEntries(
    DEGREES.map((degree) => [
      degree,
      Object.fromEntries(RATE_SHEETS.map((sheet) => [sheet, year?.[degree]?.[sheet]?.toString() ?? ""])),
    ]),
  ) as Typed;

/** The table as typed, or the first cell that is not a rate. */
function ratesFrom(typed: Typed): YearRates | string {
  const rates: YearRates = {};
  for (const degree of DEGREES) {
    for (const sheet of RATE_SHEETS) {
      const text = typed[degree][sheet].trim().replace(",", ".");
      if (!text) continue;
      const rate = Number(text);
      if (!Number.isFinite(rate) || rate < 0) return `${DEGREE_WORDS[degree]} ${SHEET_WORDS[sheet]}: a rate is a number of dirhams, 0 or more.`;
      rates[degree] = { ...rates[degree], [sheet]: rate };
    }
  }
  return rates;
}

/** "2026-2027" -> "2027-2028". */
const nextYear = (year: string) => {
  const first = Number(year.slice(0, 4)) + 1;
  return `${first}-${first + 1}`;
};

export function PayRatesPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const table = useQuery({ queryKey: ["pay-rates"], queryFn: fetchPayRates, retry: false });
  const thisYear = academicYearOf(new Date());
  const years = useMemo(() => {
    const held = Object.keys(table.data ?? {});
    const offered = new Set([...held, thisYear, nextYear(thisYear)]);
    return [...offered].sort().reverse();
  }, [table.data, thisYear]);
  const [year, setYear] = useState(thisYear);
  const [typed, setTyped] = useState<Typed>(() => typedFrom(undefined));
  const [said, setSaid] = useState("");
  // The table shown is the year chosen, as saved, until somebody types in it.
  useEffect(() => {
    setTyped(typedFrom(table.data?.[year]));
    setSaid("");
  }, [table.data, year]);
  const save = useMutation({
    mutationFn: (rates: YearRates) => setYearRates(year, rates),
    onSuccess: (saved) => {
      client.setQueryData(["pay-rates"], saved);
      // The rates on every approved sheet, and on the profiles, are read from this table.
      void client.invalidateQueries({ queryKey: ["submitted-time-sheets"] });
      setSaid(`Saved the ${year} rates.`);
    },
  });
  const checked = ratesFrom(typed);
  const held = Boolean(table.data?.[year]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <SelectMenu
            label="Academic year"
            value={year}
            onChange={setYear}
            options={years.map((option) => ({
              value: option,
              label: table.data?.[option] ? option : `${option} (not set)`,
            }))}
          />
        </div>
        {!held && !table.isPending ? (
          <span className="text-xs text-[#8a6116]">No rates for {year} yet: its sheets go out with the rate blank.</span>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#d9dee7]">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#e4e8ef] text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
              <th scope="col" className="px-3 py-2 text-left">Degree</th>
              {RATE_SHEETS.map((sheet) => (
                <th key={sheet} scope="col" className="px-3 py-2 text-left">
                  {SHEET_WORDS[sheet]} <span className="font-normal normal-case">(AED / h)</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEGREES.map((degree) => (
              <tr key={degree} className="border-b border-[#f2f4f7] last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-semibold text-[#344054]">
                  {DEGREE_WORDS[degree]}
                </th>
                {RATE_SHEETS.map((sheet) => (
                  <td key={sheet} className="px-3 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={typed[degree][sheet]}
                      // Not before the saved table has arrived, which would replace what was typed.
                      disabled={!canChange || save.isPending || table.isPending}
                      placeholder="not paid"
                      aria-label={`${DEGREE_WORDS[degree]} ${SHEET_WORDS[sheet]} rate`}
                      onChange={(event) =>
                        setTyped({ ...typed, [degree]: { ...typed[degree], [sheet]: event.target.value } })
                      }
                      className="h-9 w-28 rounded-md border border-[#b7bec8] px-2 text-right tabular-nums placeholder:text-left placeholder:text-[#c8d0da] disabled:bg-[#f8fafc]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#667085]">
        Other work is office hours and admin. Leave a cell empty for work that degree is not paid for: its sheet then
        goes out with no rate, and says why.
        {canChange ? "" : " Only an administrator can change the rates."}
      </p>
      {canChange ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={save.isPending || typeof checked === "string"}
            onClick={() => typeof checked !== "string" && save.mutate(checked)}
            className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {save.isPending ? "Saving…" : `Save ${year}`}
          </button>
          {typeof checked === "string" ? (
            <span role="alert" className="text-sm text-[#8f1f25]">
              {checked}
            </span>
          ) : save.error ? (
            <span role="alert" className="text-sm text-[#8f1f25]">
              {(save.error as Error).message}
            </span>
          ) : said ? (
            <span className="text-sm text-[#2f6b3d]">{said}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
