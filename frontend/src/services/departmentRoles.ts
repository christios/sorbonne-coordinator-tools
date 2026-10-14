/**
 * Who holds the roles the department's paperwork names: the Head of Department, set by an
 * administrator in Settings → Department and read by every Part Time Sheet.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const HEAD = `${API_BASE_URL}/api/v1/department-roles/head-of-department`;

export type HeadOfDepartment = {
  /** An Active teacher's row; "" when nobody is named. */
  activeTeacherId: string;
  fullName: string;
  email: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string;
};

async function answer(response: Response): Promise<HeadOfDepartment> {
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
  return (await response.json()) as HeadOfDepartment;
}

export async function fetchHeadOfDepartment(): Promise<HeadOfDepartment> {
  return answer(await apiFetch(HEAD));
}

/** A blank id names nobody. */
export async function setHeadOfDepartment(activeTeacherId: string): Promise<HeadOfDepartment> {
  return answer(
    await apiFetch(HEAD, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeTeacherId }),
    }),
  );
}
