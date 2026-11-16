/**
 * Hour reductions ("décharges"): the teaching a full-timer is let off, year by year.
 *
 * A full-timer owes 192 hours a year. Research through SAFIR buys some back — the teacher
 * declares it, the Head of Department checks it with SAFIR — and so do the department's own
 * responsibilities, which the Head of Department sets. A full-timer goes through theirs as
 * the first step of the timetable preferences request; the Head of Department sees every
 * full-timer's on a page of their own.
 *
 * The server works the hours out from the rules; `hoursOf` does the same here so a figure
 * typed shows its hours at once, before anything is saved.
 */

import { apiFetch, API_BASE_URL } from "@/services/http";

const BASE = `${API_BASE_URL}/api/v1/hour-reductions`;

export type ReductionGroup = "safir" | "department";
/** What a kind counts: students, hours, a yes, which committees, or one option from a list. */
export type ReductionUnit = "students" | "hours" | "yes" | "committees" | "choice";
/** The teacher's word not yet checked; checked with SAFIR; the Head of Department's own. */
export type ReductionState = "" | "declared" | "validated" | "set";

export type ReductionOption = { key: string; label: string; hours: number };

export type ReductionRule = {
  kind: string;
  group: ReductionGroup;
  label: string;
  unit: ReductionUnit;
  /** The rule in words, written from its figures. */
  rule: string;
  per: number | null;
  cap: number | null;
  /** IRG: what the project's three years share. */
  threeYears?: number;
  options?: ReductionOption[];
};

export type ReductionItem = ReductionRule & {
  amount: number;
  /** Which committees ("budget,ethics"), or which option. */
  detail: string;
  hours: number;
  state: ReductionState;
  updatedAt: string;
  updatedBy: string;
  validatedAt: string;
  /** IRG: what this year may still take of the project's hours. */
  available?: number;
};

/** One teacher's year. */
export type ReductionSheet = {
  year: string;
  service: number;
  items: ReductionItem[];
  total: number;
  /** What is left to teach: never below nothing. */
  owed: number;
  declaredAt: string;
  declaredBy: string;
  note: string;
};

export type ReductionYear = {
  year: string;
  service: number;
  rules: ReductionRule[];
  teachers: (ReductionSheet & { teacherId: string; name: string; fullTime: boolean; head: boolean })[];
  /** The teachers' reductions: the Head of Department named in Settings, or an administrator. */
  canChange: boolean;
  /** The rules they are worked out from (192 h, rates, caps): an administrator alone. */
  canChangeRules?: boolean;
};

/** What a kind is given: how many, which, and — the Head of Department's — whether SAFIR confirmed it. */
export type ReductionInput = { amount?: number; detail?: string | string[]; validated?: boolean };

export type ReductionRules = { service: number; rules: ReductionRule[] };

/** "2026–2027", as a page says a year. */
export const yearWords = (year: string) => year.replace("-", "–");

/** The hours a kind gives for what it is given, as the server works them out. */
export function hoursOf(rule: ReductionRule, amount: number, detail: string): number {
  const cap = rule.cap ?? Number.POSITIVE_INFINITY;
  switch (rule.unit) {
    case "students":
      return Math.min(cap, amount * (rule.per ?? 0));
    case "hours":
      return Math.min(cap, amount);
    case "yes":
      return amount ? (rule.per ?? 0) : 0;
    case "committees":
      return (rule.per ?? 0) * detail.split(",").filter(Boolean).length;
    default:
      return rule.options?.find((option) => option.key === detail)?.hours ?? 0;
  }
}

/** What a kind holds, in a few words: "3 students", "Budget, Ethics", "Foundation Year". */
export function heldWords(item: Pick<ReductionItem, "unit" | "amount" | "detail" | "options">): string {
  if (item.unit === "students") return item.amount ? `${item.amount} student${item.amount === 1 ? "" : "s"}` : "";
  if (item.unit === "hours") return item.amount ? `${item.amount} h` : "";
  if (item.unit === "yes") return item.amount ? "Yes" : "";
  const keys = item.detail.split(",").filter(Boolean);
  return keys.map((key) => item.options?.find((option) => option.key === key)?.label ?? key).join(", ");
}

/** What a state reads as, beside a kind. */
export function stateWords(state: ReductionState): string {
  if (state === "declared") return "Declared, to be validated";
  if (state === "validated") return "Validated with SAFIR";
  if (state === "set") return "Set by the Head of Department";
  return "";
}

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "That could not be done. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the fallback stands
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The year a portal term is in, with every full-timer of it. */
export async function fetchReductionYear(termCode: string): Promise<ReductionYear> {
  return answer(await apiFetch(`${BASE}?term=${encodeURIComponent(termCode)}`));
}

export async function saveDepartmentReductions(
  year: string,
  teacherId: string,
  items: Record<string, ReductionInput>,
): Promise<ReductionSheet> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(year)}/${encodeURIComponent(teacherId)}`, json("PUT", { items })));
}

export async function fetchReductionRules(): Promise<ReductionRules> {
  return answer(await apiFetch(`${BASE}/rules`));
}

/** An administrator's figures: the service, and per kind the figures that change. */
export async function saveReductionRules(input: {
  service?: number;
  /** A headship's options as a list: a key kept keeps its teachers; one without a key is new. */
  rules: Record<string, { per?: number; cap?: number; threeYears?: number; options?: { key?: string; label: string; hours: number }[] }>;
}): Promise<ReductionRules> {
  return answer(await apiFetch(`${BASE}/rules`, json("PUT", input)));
}
