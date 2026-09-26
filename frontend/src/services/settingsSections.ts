/**
 * The pages of Settings, in the order the account menu and the page itself list them.
 *
 * One list for both, so the menu can never offer a page the page does not have. Who may
 * sign in and the tokens scripts use are an administrator's; the checks are everybody's to
 * read — a coordinator not told why something is quiet assumes it is broken — and an
 * administrator's to change.
 */

import { ArrowLeftRight, CalendarDays, HardDrive, KeyRound, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";

import type { SettingsSection } from "@/routes/toolRoute";

export const SETTINGS_SECTIONS: { section: SettingsSection; label: string; Icon: LucideIcon; adminOnly: boolean }[] = [
  { section: "users", label: "Users", Icon: Users, adminOnly: true },
  { section: "tokens", label: "API tokens", Icon: KeyRound, adminOnly: true },
  { section: "checks", label: "Checks", Icon: SlidersHorizontal, adminOnly: false },
  // Everybody's to read, since placing a student depends on it; an administrator's to change.
  { section: "programme-codes", label: "Programme codes", Icon: ArrowLeftRight, adminOnly: false },
  // Where each semester's Week 1 is; everybody's to read, an administrator's to set.
  { section: "semesters", label: "Semesters", Icon: CalendarDays, adminOnly: false },
  // What this browser holds and nobody else does: the portal's names and their history.
  { section: "this-browser", label: "This browser", Icon: HardDrive, adminOnly: false },
];

/** The pages this person may open, in menu order. */
export function sectionsFor(isAdmin: boolean): typeof SETTINGS_SECTIONS {
  return SETTINGS_SECTIONS.filter((entry) => isAdmin || !entry.adminOnly);
}

/** Which page an address names, or the first this person may open when it names none of theirs. */
export function sectionFrom(hash: string, isAdmin: boolean): SettingsSection {
  const named = hash.replace(/^#\/?/, "").split("/").filter(Boolean)[1] ?? "";
  const mine = sectionsFor(isAdmin);
  return mine.find((entry) => entry.section === named)?.section ?? mine[0].section;
}
