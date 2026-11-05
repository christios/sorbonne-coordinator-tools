import { useRemembered } from "@/components/useRemembered";

/** A number this browser keeps, back inside its range if the range has moved since. */
export function useKeptNumber(key: string, range: { min: number; max: number; start: number }): [number, (next: number) => void] {
  const [held, setHeld] = useRemembered(key);
  const value = Number(held);
  const kept = held && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : range.start;
  return [kept, (next) => setHeld(String(next))];
}

