/** One choice of the allowed list; the shape the select menu takes. */
export type CodeOption = { value: string; label: string; badge?: string; badgeTone?: "accent" };

/**
 * What the allowed list offers: first what the cohort's students are actually registered
 * in outside their groups, then every course the department's portal list holds.
 *
 * The department's list alone never carried sport or another department's language —
 * they are not its courses — so the two things anybody wants on this list were the two
 * it could not offer, and had to be typed in under it. Each subject comes with its own
 * courses and how many students take them, so SPRT reads as "18 students" at a glance.
 */
export function electiveOptions(electives: { studentId: string; courseCode: string }[], ours: string[]): CodeOption[] {
  const takers = new Map<string, Set<string>>();
  for (const elective of electives) {
    const code = elective.courseCode.trim().toUpperCase();
    if (!code) continue;
    for (const key of new Set([code.split("-", 1)[0], code])) {
      takers.set(key, (takers.get(key) ?? new Set()).add(elective.studentId));
    }
  }
  const taken = [...takers.keys()].sort().map((code) => {
    const count = takers.get(code)?.size ?? 0;
    return { value: code, label: code, badge: `${count} student${count === 1 ? "" : "s"}`, badgeTone: "accent" as const };
  });
  const rest = [
    ...new Set(
      ours.flatMap((raw) => {
        const code = raw.trim().toUpperCase();
        return code ? [code.split("-", 1)[0], code] : [];
      }),
    ),
  ]
    .filter((code) => !takers.has(code))
    .sort()
    .map((code) => ({ value: code, label: code }));
  return [...taken, ...rest];
}
