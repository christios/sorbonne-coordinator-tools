/**
 * The academic year a semester belongs to, for the pill every semester menu shows beside
 * it — as the cohort menus show a cohort's year.
 *
 * Said by the registrar's term code where the semester is linked to one ("262720" is
 * 2026-27), and by the semester's own name otherwise ("Semester 2 2026-27"). The name is
 * then shown without it, since the pill beside it says it: "Semester 2", 2026-27.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchSemesterShortNames, fetchTermLinks } from "@/services/portalLists";

/** "2026-27" for the term code "262720": its first four digits are the two years. */
export function yearOfTermCode(code: string): string {
  const found = /^(\d{2})(\d{2})\d{2}$/.exec(code.trim());
  return found ? `20${found[1]}-${found[2]}` : "";
}

/** The year a name says, when it says one: "Semester 2 2026-27" says 2026-27. */
export function yearInName(name: string): string {
  return /\b(20\d{2}-\d{2})\b/.exec(name)?.[1] ?? "";
}

/** The name without the year the pill beside it says: "Semester 2". The whole name if that leaves nothing. */
export function withoutYear(name: string, year: string): string {
  if (!year || !name.includes(year)) return name;
  return name.replace(year, "").replace(/\s{2,}/g, " ").trim() || name;
}

/**
 * A semester as a menu option shows it: its name, less the year, and the year as a pill.
 * Spread into the option, with whatever count or badge the menu adds.
 */
export function semesterShown(name: string, year: string, short = ""): { label: string; year?: string; short?: string } {
  const named = short ? { short } : {};
  return year ? { label: withoutYear(name, year), year, ...named } : { label: name, ...named };
}

/**
 * The year of each semester of the app, from the portal term it is linked to or its name.
 * Shared by every semester menu, so the same semester says the same year on every page.
 */
export function useSemesterYears(): (term: { id: string; name: string }) => string {
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false, staleTime: 60_000 });
  return (term) => yearOfTermCode(links.data?.[term.id] ?? "") || yearInName(term.name);
}

/**
 * A semester as every menu shows it: its name less the year, the year as a pill, and the
 * short name a coordinator gave it (S1, S2) as a tag in front. Shared, so the same semester
 * reads the same on every page.
 */
export function useSemesterShown(): (term: { id: string; name: string }) => { label: string; year?: string; short?: string } {
  const yearOf = useSemesterYears();
  const shortOf = useSemesterShortNames();
  return (term) => semesterShown(term.name, yearOf(term), shortOf(term.id));
}

/**
 * Each semester's short name by its id — S1, S2 — or "". For the menus that name a cohort
 * within a semester: the cohort carries its semester's tag, "S1 · L1".
 */
export function useSemesterShortNames(): (termId: string | undefined) => string {
  const shorts = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false, staleTime: 60_000 });
  return (termId) => (termId ? (shorts.data?.[termId] ?? "") : "");
}
