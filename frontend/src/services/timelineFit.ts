/** How tall a class may grow to fill the screen. Past this a box is only a taller colour. */
const MOST_ROW = 160;

/**
 * The tallest a class can be with every row still on screen, and never less than asked.
 *
 * The height slider says how tall a class must at least be to be read. A week that needs
 * less than the screen used to stop there and leave the rest of the page blank — a filter
 * down to one teacher was five thin rows and a white afternoon. Now the rows share out
 * whatever the screen has left, so the week is as large as the room it is given.
 */
export function fittedRowHeight(available: number, lanes: number[], atLeast: number, label: number): number {
  const needs = (height: number) => lanes.reduce((total, rows) => total + Math.max(label, rows * height + 6) + 1, 0);
  if (available <= 0 || lanes.length === 0 || needs(atLeast) > available) return atLeast;
  let low = atLeast;
  let high = MOST_ROW;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (needs(middle) <= available) low = middle;
    else high = middle - 1;
  }
  return low;
}
