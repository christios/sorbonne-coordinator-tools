import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type SignInConfig = { configured: boolean; clientId: string | null };
export type StaffUser = { email: string; name: string };

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
}
