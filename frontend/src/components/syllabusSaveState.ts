export type SyllabusSaveState = "saved" | "saving" | "error" | "conflict";

export function saveFailureState(
  error: unknown,
): Extract<SyllabusSaveState, "error" | "conflict"> {
  return error instanceof Error && /changed elsewhere|revision conflict/i.test(error.message)
    ? "conflict"
    : "error";
}
