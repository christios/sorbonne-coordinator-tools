import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { useSemesterShortNames } from "@/services/semesterYears";

type CohortLike = {
  id: string;
  name: string;
  term?: string;
  /** Its students, every semester together. */
  memberCount?: number;
  /** Its students in each semester, by the semester's id. */
  memberCounts?: Record<string, number>;
};

/** A cohort's students in the semester shown, or in all of them when no semester is said. */
export function studentsIn(cohort: CohortLike, semesterId?: string): number {
  if (semesterId && cohort.memberCounts) return cohort.memberCounts[semesterId] ?? 0;
  return cohort.memberCount ?? 0;
}

/**
 * Every menu that chooses a cohort, saying each one the same way: the semester's tag, the
 * cohort's year, its name and its students in that semester — "S2 · 2026-27 · L1 · 108".
 *
 * One component, so a cohort reads the same on Cohorts, Groups & CRNs, the Group schema,
 * Capacity, the move dialog and the workbook and portal dialogs. A cohort is a year's and
 * is worked a semester at a time, so the tag is the semester the menu is about.
 */
export function CohortMenu<T extends CohortLike>({
  cohorts,
  value,
  onChange,
  semesterId,
  label = "Cohort",
  placeholder,
  align,
  searchable,
  more,
}: {
  cohorts: T[];
  value: string;
  onChange: (cohortId: string) => void;
  /** The semester the cohorts are shown in: its short name is the tag in front of each. */
  semesterId?: string;
  label?: string;
  placeholder?: string;
  align?: "start" | "center" | "end";
  /** A search box at the top of the list, for a long one. */
  searchable?: boolean;
  /** Anything more an option says on a particular page. */
  more?: (cohort: T) => Partial<SelectOption>;
}) {
  const shortOf = useSemesterShortNames();
  const short = shortOf(semesterId);
  return (
    <SelectMenu
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      align={align}
      searchable={searchable}
      options={cohorts.map((cohort) => {
        const count = studentsIn(cohort, semesterId);
        return {
          value: cohort.id,
          label: cohort.name,
          short,
          year: cohort.term || undefined,
          badge: String(count),
          badgeTone: count ? ("accent" as const) : ("muted" as const),
          ...more?.(cohort),
        };
      })}
    />
  );
}
