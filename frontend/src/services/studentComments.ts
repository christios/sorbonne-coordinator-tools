/**
 * A thread of comments on a student, kept on the server.
 *
 * What a coordinator knows about a student used to live in their head and their inbox;
 * the next person to open the record knew none of it. Each line is signed by whoever
 * wrote it — the server reads that off the session, never the client — and dated.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = "/api/v1/student-database";

export type StudentComment = {
  id: string;
  studentId: string;
  body: string;
  authorEmail: string;
  authorName: string;
  /** ISO, as the server wrote it. */
  createdAt: string;
};

/** Per student: how many lines, and when the last was written. Only students with any. */
export type CommentSummary = Record<string, { count: number; lastAt: string }>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    let detail = "";
    try {
      detail = String(
        ((await response.json()) as { detail?: unknown }).detail ?? "",
      );
    } catch {
      // No body worth reading; the status says enough.
    }
    throw new Error(
      detail || "That could not be saved. Try again in a moment.",
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function fetchComments(
  studentId: string,
): Promise<StudentComment[]> {
  return (
    await request<{ comments: StudentComment[] }>(
      `${BASE}/students/${encodeURIComponent(studentId)}/comments`,
    )
  ).comments;
}

export function postComment(
  studentId: string,
  body: string,
): Promise<StudentComment> {
  return request<StudentComment>(
    `${BASE}/students/${encodeURIComponent(studentId)}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

export function deleteComment(commentId: string): Promise<void> {
  return request<void>(`${BASE}/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
  });
}

export async function fetchCommentSummary(): Promise<CommentSummary> {
  return (await request<{ counts: CommentSummary }>(`${BASE}/comments/summary`))
    .counts;
}
