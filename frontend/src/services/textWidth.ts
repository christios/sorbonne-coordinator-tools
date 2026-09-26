/**
 * How wide Helvetica — the PDF's own font — sets a piece of text, without a PDF to ask.
 *
 * The semester export decides how tall a class must be, and how many pages a week takes,
 * before anything is drawn: the preview is worked out the same way the file is, and a
 * class whose words would not fit must be given the room for them rather than have them
 * dropped. So it needs the widths the file will use. These are the PDF library's own
 * standard Helvetica metrics, per thousandth of the font size, for the printable ASCII
 * characters; anything else is taken at the width of a typical letter.
 */

const FIRST = 32;
const NORMAL = [280, 280, 350, 550, 550, 890, 660, 190, 330, 330, 390, 580, 280, 330, 280, 280, 550, 550, 550, 550, 550, 550, 550, 550, 550, 550, 280, 280, 580, 580, 580, 550, 1010, 660, 660, 720, 720, 660, 610, 780, 720, 280, 500, 660, 550, 830, 720, 780, 660, 780, 720, 660, 610, 720, 660, 940, 660, 660, 610, 280, 280, 280, 470, 550, 330, 550, 550, 500, 550, 550, 280, 550, 550, 220, 220, 500, 220, 830, 550, 550, 550, 550, 330, 500, 280, 550, 500, 720, 500, 500, 500, 330, 260, 330, 580];
const BOLD = [280, 330, 470, 550, 550, 890, 720, 240, 330, 330, 390, 580, 280, 330, 280, 280, 550, 550, 550, 550, 550, 550, 550, 550, 550, 550, 330, 330, 580, 580, 580, 610, 970, 720, 720, 720, 720, 660, 610, 780, 720, 280, 550, 720, 610, 830, 720, 780, 660, 780, 720, 660, 610, 720, 660, 940, 660, 660, 610, 330, 280, 330, 580, 550, 330, 550, 610, 550, 610, 550, 330, 610, 610, 280, 280, 550, 280, 890, 610, 610, 610, 610, 390, 550, 330, 610, 550, 780, 550, 550, 500, 390, 280, 390, 580];

/** A few characters the timetable prints that are not ASCII. */
const WIDE: Record<string, [number, number]> = {
  "–": [556, 556],
  "—": [1000, 1000],
  "·": [278, 278],
  "…": [1000, 1000],
};

/** The width of `text` in points at `size`, in the regular or bold weight. */
export function textWidth(text: string, size: number, bold = false): number {
  const table = bold ? BOLD : NORMAL;
  let thousandths = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    const known = WIDE[character];
    thousandths += known ? known[bold ? 1 : 0] : code >= FIRST && code - FIRST < table.length ? table[code - FIRST] : 556;
  }
  return (thousandths / 1000) * size;
}
