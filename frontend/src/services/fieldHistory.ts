export type FieldHistoryEntry = {
  previousValue: unknown;
  newValue: unknown;
  revision: number;
  changedAt: string;
  operations?: WordDiffOperation[];
};

export type WordDiffOperation =
  | { type: "equal" | "insert" | "delete"; text: string }
  | { type: "substitute"; left: string; right: string };
