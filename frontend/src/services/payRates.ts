/**
 * The department's pay rates for part-timers: a table per academic year, a row per degree,
 * a column per Part Time Sheet. Set by an administrator in Settings → Department.
 *
 * An empty cell is work that degree is not paid for — a Bachelors does not give lectures.
 */

import { apiFetch } from "@/services/http";
import { SHEET_WORDS, type Degree, type PartTimeSheetType, type PayIssue } from "@/services/teachers";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/pay-rates`;

export const DEGREES: Degree[] = ["phd", "masters", "bachelors"];
export const DEGREE_WORDS: Record<Degree, string> = { phd: "PhD", masters: "Masters", bachelors: "Bachelors" };
export const RATE_SHEETS: PartTimeSheetType[] = ["CM", "TD-TP", "OTHER"];

/** One year: degree -> sheet -> rate. A cell missing is not paid. */
export type YearRates = Partial<Record<Degree, Partial<Record<PartTimeSheetType, number>>>>;
/** "2026-2027" -> that year's table. */
export type RateTable = Record<string, YearRates>;

async function answer(response: Response): Promise<RateTable> {
  if (!response.ok) {
    let detail = "That could not be saved. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the default sentence stands
    }
    throw new Error(detail);
  }
  return ((await response.json()) as { years: RateTable }).years;
}

export async function fetchPayRates(): Promise<RateTable> {
  return answer(await apiFetch(BASE));
}

export async function setYearRates(year: string, rates: YearRates): Promise<RateTable> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(year)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rates }),
    }),
  );
}

/** "2026-2027": the academic year a day falls in — August opens it, as the pay periods do. */
export function academicYearOf(day: Date): string {
  const first = day.getMonth() >= 7 ? day.getFullYear() : day.getFullYear() - 1;
  return `${first}-${first + 1}`;
}

/** Why a sheet goes out with no rate, in a sentence. */
export function payIssueSaid(issue: PayIssue): string {
  if (issue.kind === "no_degree") {
    return "No highest degree on their profile, so the rate is left blank. Add it under Edit profile.";
  }
  if (issue.kind === "no_rates") {
    return `No pay rates for ${issue.year} in Settings → Department, so the rate is left blank.`;
  }
  return `${SHEET_WORDS[issue.sheet]} hours, which a ${DEGREE_WORDS[issue.degree]} teacher is not paid for: that sheet goes out with no rate.`;
}

