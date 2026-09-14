/**
 * How much room a field needs, taken from the longest value the data actually holds.
 *
 * Measured across the 909 imported courses and the syllabus catalogue: a course code runs
 * to 10 characters, a course title to 30 (the registrar caps it there), the course picker's
 * "code — title" line to 43, a programme title to 59, a person's name to 21. The extra
 * 3.5rem in each is the box's own padding and the history icon inside its right edge.
 *
 * A size is a ceiling, never a fixed width: `max-w-full` keeps a field inside its column on
 * a narrow screen. It caps the width only — a value too long for it wraps onto another line
 * rather than being cut off or scrolled out of sight.
 *
 * Each carries its width twice: `w-` for a field standing in a block, `basis-` for one
 * sitting in a row of fields, where flex reads the basis and ignores the width. The minimum
 * keeps a field at least as wide as the label naming it, so a name does not wrap above a box
 * it barely exceeds — but only once there is a row to speak of: on a phone every field is
 * full width already, and asking for the label's width there pushed boxes past the card.
 *
 * Written out in full because Tailwind reads these names from the source as they are.
 */
export type FieldSize = "counter" | "code" | "name" | "title" | "line" | "full";

export const fieldSizeClass: Record<FieldSize, string> = {
  /** Four digits, and room for "Number of ECTS" to stay on one line above them. */
  counter: "w-[calc(6ch+3.5rem)] basis-[calc(6ch+3.5rem)] sm:min-w-fit max-w-full",
  /** Twelve characters: a course code, an academic year, "L3-S5". */
  code: "w-[calc(12ch+3.5rem)] basis-[calc(12ch+3.5rem)] sm:min-w-fit max-w-full",
  /** Twenty-six: a person's name, a short label. */
  name: "w-[calc(26ch+3.5rem)] basis-[calc(26ch+3.5rem)] sm:min-w-fit max-w-full",
  /** Forty-four: a course title, and the picker's "code — title" line. */
  title: "w-[calc(44ch+3.5rem)] basis-[calc(44ch+3.5rem)] sm:min-w-fit max-w-full",
  /** Sixty-four: a programme title. */
  line: "w-[calc(64ch+3.5rem)] basis-[calc(64ch+3.5rem)] sm:min-w-fit max-w-full",
  /** Prose, which takes the column it is given. */
  full: "w-full basis-full",
};
