/**
 * Telling whether two spellings of a programme are the same programme.
 *
 * The registrar writes a programme as its code and its description together —
 * "MATH - Mathematics" — and that string arrives on a student's record as MAJOR_CODE_DESC.
 * A group's sub-row holds one too, chosen from the same list, and matching the two is what
 * decides which students a group is open to and which section each of them is taught.
 *
 * Matching the whole string made the description load-bearing. It is not ours: the
 * registrar owns it and may reword it at any time, for reasons that have nothing to do
 * with us — a new degree title, a spelling corrected, a level added. The day that happens
 * every sub-row still says the old wording, matches nobody, and the groups holding them go
 * quietly closed: no error, no empty state, just students the fill declines to place with
 * no reason given. Nothing on the screen would say why.
 *
 * So the code decides, and the description is a label. A code is what the portal filters
 * by, what a cohort's expectations are written in, and the part that does not change when
 * somebody rewrites the words after it.
 */

/**
 * The department's word on which codes are the same students: `code -> the code it means`.
 *
 * Admissions may move the code itself, not just the words after it — L2's MATH became
 * MATS in September 2026, and every mathematician stopped matching the rows they sat on.
 * Settings → Programme codes says so once ("MATS means MATH"), and every comparison below
 * reads it. Loaded before the student pages open; empty until then, which is what the
 * application meant before there was a list.
 */
let sameAs = new Map<string, string>();

export function rememberProgrammeCodes(pairs: readonly { code: string; sameAs: string }[]): void {
  sameAs = new Map(pairs.map((pair) => [pair.code.trim().toUpperCase(), pair.sameAs.trim().toUpperCase()]));
}

/**
 * "MATH - Mathematics" → "MATH"; a programme written as a bare code is already one — and a
 * code the department treats as another is filed under the one it means.
 */
export function programCode(program: string): string {
  const parts = program.split(/\s+-\s+/);
  const code = (parts.length > 1 ? parts[0] : program).trim().toUpperCase();
  return sameAs.get(code) ?? code;
}

/**
 * Whether these two name the same programme.
 *
 * Blank matches nothing, on either side: a sub-row naming no programme is a sub-row for
 * everybody, and that is decided elsewhere rather than by pretending it matches.
 */
export function sameProgram(left: string, right: string): boolean {
  return Boolean(left.trim()) && Boolean(right.trim()) && programCode(left) === programCode(right);
}

/** Whether any of these programmes is that one. */
export function amongPrograms(programs: readonly string[], one: string): boolean {
  return programs.some((program) => sameProgram(program, one));
}
