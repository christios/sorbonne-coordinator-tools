/**
 * The invited teacher's side of timetable wishes: what their link is for, signing in with the
 * Google account it was sent to, and their own answer — through a door of its own on the
 * server, which a staff session does not open and which opens nothing else.
 *
 * The SCEN Requests app will do the same for the teachers on its list (stage 3).
 */

import { apiFetch, API_BASE_URL } from "@/services/http";
import type { AnswerWindow, WishCalendar, WishCollection, Wishes, WishesInput } from "@/services/teacherWishes";

const DOOR = `${API_BASE_URL}/api/v1/invite/wishes`;

/** What a link says before signing in: the semester, whose wishes, and the address, masked. */
export type Invitation = {
  semesterName: string;
  teacherName: string;
  email: string;
  deadline: string;
  message: string;
  signedIn: boolean;
};

/** What the teacher's page shows once signed in. */
export type InviteeForm = {
  semesterName: string;
  teacherName: string;
  email: string;
  collection: WishCollection | null;
  /** The semester's teaching weeks, to mark time away on. */
  calendar?: WishCalendar | null;
  wishes: Wishes | null;
  window: AnswerWindow;
  /** Their latest answer for another semester, to start this one from: without its time away. */
  previous: { termCode: string; semesterName: string; wishes: Wishes } | null;
};

/** A refusal, with the server's own words; `gone` when the link itself is no good. */
export class InviteRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function answer<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let detail = fallback;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the fallback stands
    }
    throw new InviteRefused(detail, response.status);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const at = (code: string, rest = "") => `${DOOR}/${encodeURIComponent(code)}${rest}`;

export async function fetchInvitation(code: string): Promise<Invitation> {
  return answer(await apiFetch(at(code)), "This invitation could not be read. Try again in a moment.");
}

export async function signInInvitee(code: string, credential: string): Promise<InviteeForm> {
  return answer(
    await apiFetch(at(code, "/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    }),
    "That sign-in could not be completed.",
  );
}

export async function signOutInvitee(code: string): Promise<void> {
  return answer(await apiFetch(at(code, "/session"), { method: "DELETE" }), "That could not be done.");
}

export async function fetchInviteeForm(code: string): Promise<InviteeForm> {
  return answer(await apiFetch(at(code, "/form")), "Your answer could not be read. Try again in a moment.");
}

export async function saveInviteeAnswer(code: string, input: WishesInput): Promise<InviteeForm> {
  return answer(
    await apiFetch(at(code, "/answer"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
    "That could not be saved. Try again in a moment.",
  );
}

/**
 * On a developer's own machine only: be the invited teacher without their Google account, to
 * look at their side. The server answers it only with a local database; the button calling it
 * is built only into the local copy.
 */
export async function openAsInviteeHere(code: string): Promise<void> {
  return answer(
    await apiFetch(`${API_BASE_URL}/api/v1/dev/wish-invitee-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    "Only the local copy can do that.",
  );
}
