/**
 * What a rolled-over cohort will be called: L1-S1 continues as L1-S2.
 *
 * The server's own rule, said here so the tab can show the name before anything is made.
 * A name that ends in no semester number takes the portal term instead.
 */
export function nextSemesterName(name: string, termCode: string): string {
  const found = /S(\d+)$/.exec(name);
  if (found) return `${name.slice(0, found.index)}S${Number(found[1]) + 1}`;
  return `${name} (${termCode})`;
}
