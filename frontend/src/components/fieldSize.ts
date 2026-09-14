/**
 * How much room a field needs, taken from the longest value the data actually holds.
 *
 * Measured across the 909 imported courses and the syllabus catalogue: a course code runs
 * to 10 characters, a course title to 30 (the registrar caps it there), the course picker's
 * "code — title" line to 43, a programme title to 59, a person's name to 21. The extra
 * 3.5rem in each is the box's own padding and the history icon inside its right edge.
 *
 * Three numbers each, and they do different jobs.
 *
 * The **basis** is what the field asks for, and what decides how many fit on a row.
 *
 * The fields on a row then **grow** to share out whatever is left, so a row runs margin to
 * margin rather than trailing off. That is why there is a **maximum** as well: without one,
 * a small field that wrapped onto a line by itself would stretch a two-digit box across the
 * whole card. Each is allowed roughly double, and never more than the room it is given.
 *
 * The minimum is the width the field's own name needs on one line, so adding an information
 * button to a label widens the box a little rather than folding the name underneath it. It
 * has to be the label's *minimum* rather than its preferred width: a box claims an intrinsic
 * width of twenty characters, and asking for `fit-content` inherits that claim, which made
 * every small field 210px instead of 110 and halved what fitted on a row. Only from `sm` up
 * — on a phone a field is the width of the card already, and a name that will not fit should
 * wrap rather than push its box off the side.
 *
 * Written out in full because Tailwind reads these names from the source as they are.
 */
export type FieldSize = "counter" | "code" | "name" | "title" | "line" | "sentence" | "full";

export const fieldSizeClass: Record<FieldSize, string> = {
  /** Six characters: contact hours, a credit. */
  counter:
    "w-[calc(6ch+3.5rem)] basis-[calc(6ch+3.5rem)] grow sm:min-w-min max-w-[min(100%,calc(14ch+3.5rem))]",
  /** Twelve: a course code, an academic year, "L3-S5". */
  code: "w-[calc(12ch+3.5rem)] basis-[calc(12ch+3.5rem)] grow sm:min-w-min max-w-[min(100%,calc(24ch+3.5rem))]",
  /** Twenty-six: a person's name. */
  name: "w-[calc(26ch+3.5rem)] basis-[calc(26ch+3.5rem)] grow sm:min-w-min max-w-[min(100%,calc(40ch+3.5rem))]",
  /** Thirty-two: a course title, which the registrar never lets past thirty. */
  title: "w-[calc(32ch+3.5rem)] basis-[calc(32ch+3.5rem)] grow sm:min-w-min max-w-[min(100%,calc(48ch+3.5rem))]",
  /** Forty-six: the course picker's "code — title" line, at most forty-three. */
  line: "w-[calc(46ch+3.5rem)] basis-[calc(46ch+3.5rem)] grow sm:min-w-min max-w-[min(100%,calc(64ch+3.5rem))]",
  /** Sixty-four: a programme title. */
  sentence:
    "w-[calc(64ch+3.5rem)] basis-[calc(64ch+3.5rem)] grow sm:min-w-min max-w-[min(100%,calc(88ch+3.5rem))]",
  /** Prose, which takes the column it is given. */
  full: "w-full basis-full grow max-w-full",
};
