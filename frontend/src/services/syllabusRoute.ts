/**
 * Where you are in the syllabus builder, kept in the address (11 Nov 2026).
 *
 * The screens were state and nothing else, so a refresh — or the browser's Back — put
 * everybody back in the library, however deep in a syllabus they had been. With the screen
 * and its section in the address, a refresh reopens the same place, Back goes back, and a
 * link to a syllabus section opens that section:
 *
 * - `#/syllabus`                          the library
 * - `#/syllabus/catalogues/<section>`     Manage catalogues, on a section
 * - `#/syllabus/<syllabus id>/<section>`  a syllabus, on a section
 * - `#/syllabus/<syllabus id>/compare`    a syllabus compared with another year
 */
import { detailFromLocation, locationFor, pageFromLocation } from "@/routes/toolRoute";

export type SyllabusScreen =
  | { view: "library" }
  | { view: "catalogues"; section?: string }
  | { view: "editor"; id: string; section?: string }
  | { view: "comparison"; id: string };

const CATALOGUES = "catalogues";
const COMPARE = "compare";

export function screenFromHash(hash: string): SyllabusScreen {
  const page = decodeURIComponent(pageFromLocation(hash));
  const detail = decodeURIComponent(detailFromLocation(hash));
  if (!page) return { view: "library" };
  if (page === CATALOGUES) return detail ? { view: "catalogues", section: detail } : { view: "catalogues" };
  if (detail === COMPARE) return { view: "comparison", id: page };
  return detail ? { view: "editor", id: page, section: detail } : { view: "editor", id: page };
}

export function hashFor(screen: SyllabusScreen): string {
  const at = (page: string, detail = "") => `#${locationFor("syllabus", encodeURIComponent(page), detail ? encodeURIComponent(detail) : "")}`;
  if (screen.view === "catalogues") return at(CATALOGUES, screen.section);
  if (screen.view === "editor") return at(screen.id, screen.section);
  if (screen.view === "comparison") return at(screen.id, COMPARE);
  return `#${locationFor("syllabus")}`;
}

/** The same screen, whatever section each names: moving between sections is not a new step. */
export function sameScreen(left: SyllabusScreen, right: SyllabusScreen): boolean {
  if (left.view !== right.view) return false;
  if (left.view === "editor" || left.view === "comparison") return left.id === (right as { id: string }).id;
  return true;
}
