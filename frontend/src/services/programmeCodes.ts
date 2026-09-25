/**
 * Programme codes the department treats as one — "MATS means MATH" — kept in Settings.
 *
 * Read by everybody, since placing a student depends on it; changed by an administrator,
 * since it changes who is placed where for the whole department. See programmes.ts for
 * where it takes effect.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/programme-codes`;

export type ProgrammeCode = { code: string; sameAs: string; createdAt: string; createdBy: string };

async function answer(response: Response): Promise<ProgrammeCode[]> {
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
  return ((await response.json()) as { codes: ProgrammeCode[] }).codes;
}

export async function fetchProgrammeCodes(): Promise<ProgrammeCode[]> {
  return answer(await apiFetch(BASE));
}

export async function setProgrammeCode(code: string, sameAs: string): Promise<ProgrammeCode[]> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sameAs }),
    }),
  );
}

export async function removeProgrammeCode(code: string): Promise<ProgrammeCode[]> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(code)}`, { method: "DELETE" }));
}
