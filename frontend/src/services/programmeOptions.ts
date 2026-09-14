/**
 * The options a programme picker offers, with whatever is stored among them.
 *
 * A `<select>` whose value matches no option does not show the value — it shows the first
 * option, silently. The two pickers on Group schema list the programmes the portal returned
 * for this browser's students, so a programme stored in any other vocabulary read as "any"
 * or "everyone" while the database said Physics.
 *
 * That is exactly what happened: the programmes were written to match the group LABELS
 * ("Physics") rather than `MAJOR_CODE_DESC` ("PHYS - Physics"), which is the field the fill
 * compares a student against. The page reported them as unset for as long as they were set,
 * and the fill's preference matched nobody the whole time.
 *
 * Seeing the wrong answer is worse than seeing an unfamiliar one. A value the list does not
 * know is added to it and marked, so it can be read and corrected rather than silently
 * replaced.
 */
export function withStored(programmes: string[], stored: string): { value: string; label: string }[] {
  const known = programmes.map((programme) => ({ value: programme, label: programme }));
  if (!stored || programmes.includes(stored)) return known;
  return [...known, { value: stored, label: `${stored} — not in this browser's pulls` }];
}
