/**
 * The reasons a student may not take a course — "LEA track", "Repeater" — kept by an
 * administrator in Settings and offered on the record's Exempt button.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/exemption-reasons`;

export type ExemptionReason = { label: string; createdAt: string; createdBy: string };

async function answer(response: Response): Promise<ExemptionReason[]> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  return ((await response.json()) as { reasons: ExemptionReason[] }).reasons;
}

export async function fetchExemptionReasons(): Promise<ExemptionReason[]> {
  return answer(await apiFetch(BASE));
}

export async function addExemptionReason(label: string): Promise<ExemptionReason[]> {
  return answer(
    await apiFetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }),
  );
}

export async function removeExemptionReason(label: string): Promise<ExemptionReason[]> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(label)}`, { method: "DELETE" }));
}
