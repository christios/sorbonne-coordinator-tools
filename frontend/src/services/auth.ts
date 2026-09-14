import { apiFetch } from "@/services/http";
import { forgetRosters } from "@/services/rosterStore";
import type { AppId } from "@/routes/apps";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type SignInConfig = { configured: boolean; clientId: string | null };
/**
 * Whoever is signed in, and what the workspace should offer them.
 *
 * `apps` is which apps they may open and what they may do in each — the platform decides it,
 * the browser only reads it, and an app missing here is one the workspace does not show.
 */
export type StaffUser = {
  email: string;
  name: string;
  isAdmin: boolean;
  /** Absent means nothing has been granted: the workspace offers what it was told to. */
  apps?: Partial<Record<AppId, "admin" | "member">>;
};

async function detail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // fall through
  }
  return fallback;
}

export async function fetchSignInConfig(): Promise<SignInConfig> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/auth/config`);
  if (!response.ok) throw new Error("The application could not be reached.");
  return (await response.json()) as SignInConfig;
}

/** Returns null when nobody is signed in, rather than throwing on the happy path. */
export async function fetchCurrentUser(): Promise<StaffUser | null> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/auth/me`);
  if (response.status === 401 || response.status === 503) return null;
  if (!response.ok) throw new Error(await detail(response, "The application could not be reached."));
  return (await response.json()) as StaffUser;
}

export async function signIn(credential: string): Promise<StaffUser> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) throw new Error(await detail(response, "That sign-in could not be completed."));
  return (await response.json()) as StaffUser;
}

export async function signOut(): Promise<void> {
  await apiFetch(`${API_BASE_URL}/api/v1/auth/session`, { method: "DELETE" });
  // The rosters pulled from the registrar live in this browser, so signing out has to
  // take them with it. Anything else would leave student names on a shared machine.
  forgetRosters();
}
