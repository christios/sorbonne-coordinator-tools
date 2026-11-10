/**
 * Course learning outcomes and the curriculum mapping (November 2026 review).
 *
 * The Head of Department's curriculum mapping says which of the programme's PLOs each
 * course is expected to serve. A CLO may only be aligned to those PLOs, and every one of
 * them must be aligned to at least one CLO.
 */
import type { CatalogueEntry } from "@/services/syllabusCatalogues";

function codeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/** The course's entry in the programme's curriculum mapping, matched on its code. */
export function mappingEntryFor(mapping: CatalogueEntry[], courseCode: string): CatalogueEntry | undefined {
  const wanted = codeKey(courseCode);
  if (!wanted) return undefined;
  return mapping.find((item) => !item.isRetired && codeKey(item.label) === wanted);
}

/** The PLOs the mapping expects of the course, by catalogue id. */
export function expectedPloIds(entry: CatalogueEntry | undefined): string[] {
  const ids = entry?.payload.ploIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The PLOs a CLO may be aligned to: the current ones the mapping expects of the course, or —
 * for a course the mapping does not list yet — every current PLO of the programme.
 */
export function alignablePlos(programmePlos: CatalogueEntry[], entry: CatalogueEntry | undefined): CatalogueEntry[] {
  const current = programmePlos.filter((plo) => !plo.isRetired);
  if (!entry) return current;
  const expected = new Set(expectedPloIds(entry));
  return current.filter((plo) => expected.has(plo.id));
}

/** The PLOs the mapping expects that no CLO is aligned to yet, by catalogue id, in mapping order. */
export function unalignedPloIds(expected: string[], clos: Array<Record<string, unknown>>): string[] {
  const aligned = new Set(
    clos.flatMap((clo) => {
      const ids = clo.ploIds;
      if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === "string");
      return typeof ids === "string" ? ids.split("\n").filter(Boolean) : [];
    }),
  );
  return expected.filter((id) => !aligned.has(id));
}
