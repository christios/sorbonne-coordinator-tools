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
 * sitting in a row of fields, where flex reads the basis and ignores the width.
 *
 * A field grows a little rather than wrapping its own name: the minimum is the width the
 * label needs on one line, which is what `min-w-min` asks for once the label is told not to
 * wrap. It has to be the minimum rather than the preferred width — a box carries an
 * intrinsic width of twenty characters, so asking for `fit-content` made every small field
 * 210px instead of 110 and halved what fitted on a row. Only from `sm` up: on a phone a
 * field is the width of the card already, and a name that cannot fit should wrap there
 * rather than push the box off the side.
 *
 * Written out in full because Tailwind reads these names from the source as they are.
 */
export type FieldSize = "counter" | "code" | "name" | "title" | "line" | "sentence" | "full";

export const fieldSizeClass: Record<FieldSize, string> = {
  /** Six characters: contact hours, a credit. */
  counter: "w-[calc(6ch+3.5rem)] basis-[calc(6ch+3.5rem)] sm:min-w-min max-w-full",
  /** Twelve: a course code, an academic year, "L3-S5". */
  code: "w-[calc(12ch+3.5rem)] basis-[calc(12ch+3.5rem)] sm:min-w-min max-w-full",
  /** Twenty-six: a person's name. */
  name: "w-[calc(26ch+3.5rem)] basis-[calc(26ch+3.5rem)] sm:min-w-min max-w-full",
  /** Thirty-two: a course title, which the registrar never lets past thirty. */
  title: "w-[calc(32ch+3.5rem)] basis-[calc(32ch+3.5rem)] sm:min-w-min max-w-full",
  /** Forty-six: the course picker's "code — title" line, at most forty-three. */
  line: "w-[calc(46ch+3.5rem)] basis-[calc(46ch+3.5rem)] sm:min-w-min max-w-full",
  /** Sixty-four: a programme title. */
  sentence: "w-[calc(64ch+3.5rem)] basis-[calc(64ch+3.5rem)] sm:min-w-min max-w-full",
  /** Prose, which takes the column it is given. */
  full: "w-full basis-full",
};
