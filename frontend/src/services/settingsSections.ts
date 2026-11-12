/**
 * The pages of Settings, in the order the account menu and the page itself list them.
 *
 * One list for both, so the menu can never offer a page the page does not have. Who may
 * sign in and the tokens scripts use are an administrator's; the checks are everybody's to
 * read — a coordinator not told why something is quiet assumes it is broken — and an
 * administrator's to change.
 */

import {
  Building2,
  HardDrive,
  KeyRound,
  Layers,
  MessageSquareText,
  MinusCircle,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { SettingsSection } from "@/routes/toolRoute";

export const SETTINGS_SECTIONS: { section: SettingsSection; label: string; Icon: LucideIcon; adminOnly: boolean }[] = [
  { section: "users", label: "Users", Icon: Users, adminOnly: true },
  { section: "tokens", label: "API tokens", Icon: KeyRound, adminOnly: true },
  { section: "checks", label: "Checks", Icon: SlidersHorizontal, adminOnly: false },
  // The students' programmes — official names, the codes that mean the same, the courses under
  // each — which placing students and every Program filter read; an administrator's to change.
  { section: "programmes", label: "Programmes", Icon: Layers, adminOnly: false },
  // What the Exempt button offers — "LEA track", "Repeater"; everybody's to read.
  { section: "exemption-reasons", label: "Exemption reasons", Icon: MinusCircle, adminOnly: false },
  // Who the Head of Department is, which every Part Time Sheet is signed with; an administrator's to set.
  { section: "department", label: "Department", Icon: Building2, adminOnly: false },
  // What this browser holds and nobody else does: the portal's names and their history.
  { section: "this-browser", label: "This browser", Icon: HardDrive, adminOnly: false },
  // Connecting Claude to read as you: everybody's own, and it needs nothing installed.
  { section: "claude", label: "Claude", Icon: MessageSquareText, adminOnly: false },
];

/** The pages this person may open, in menu order. */
export function sectionsFor(isAdmin: boolean): typeof SETTINGS_SECTIONS {
  return SETTINGS_SECTIONS.filter((entry) => isAdmin || !entry.adminOnly);
}

/** Which page an address names, or the first this person may open when it names none of theirs. */
export function sectionFrom(hash: string, isAdmin: boolean): SettingsSection {
  const written = hash.replace(/^#\/?/, "").split("/").filter(Boolean)[1] ?? "";
  // Programme codes and course programs were two pages; a link to either opens the one.
  const named = written === "programme-codes" || written === "course-programs" ? "programmes" : written;
  const mine = sectionsFor(isAdmin);
  return mine.find((entry) => entry.section === named)?.section ?? mine[0].section;
}
