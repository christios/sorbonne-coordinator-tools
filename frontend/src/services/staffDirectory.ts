import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type CoordinatorAccount = {
  email: string;
  /** What to call them: the name an administrator set, else Google's, else the address. */
  name: string;
  /** Only the name an administrator set, so the field can be edited without Google's in it. */
  displayName: string;
  isAdmin: boolean;
  isActive: boolean;
  invitedBy: string;
  createdAt: string;
  lastSeenAt: string | null;
};

/** Invited accounts, plus the owners the deployment's environment lets in. */
export type StaffList = {
  accounts: CoordinatorAccount[];
  owners: string[];
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // fall through to the generic message
  }
  return "That change could not be saved. Try again in a moment.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchStaffList(): Promise<StaffList> {
  return request<StaffList>("/api/v1/users");
}

export function inviteCoordinator(input: { email: string; isAdmin: boolean }): Promise<CoordinatorAccount> {
  return request<CoordinatorAccount>("/api/v1/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCoordinator(
  email: string,
  patch: { isAdmin?: boolean; isActive?: boolean; displayName?: string },
): Promise<CoordinatorAccount> {
  return request<CoordinatorAccount>(`/api/v1/users/${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function removeCoordinator(email: string): Promise<void> {
  return request<void>(`/api/v1/users/${encodeURIComponent(email)}`, { method: "DELETE" });
}
