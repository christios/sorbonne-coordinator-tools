/**
 * One line of a full-size box's facts (see ClassFacts) drawn by whole lines: 11px type at
 * leading-tight, and no gap between lines, since a long teacher's name wrapping inside its
 * own field has none and the count has to hold for both.
 */
export const FACTS_LINE = 11 * 1.25;

/**
 * How many whole lines of a full-size box's facts fit in this height. Half a pixel short
 * still fits: a box is measured in whole pixels, and three lines are 41.25 of them.
 */
export const linesIn = (height: number) => Math.max(0, Math.floor((height + 0.5) / FACTS_LINE));

/**
 * How tall a class's box has to be to show all of what it says (see ClassFacts): the
 * facts' own height, measured, and the box's padding and border round them. All of it,
 * where the box shows only the lines it has room for. Nought where nothing was laid out,
 * as in a test.
 */
export function heightNeeded(box: HTMLElement): number {
  const facts = box.querySelector<HTMLElement>("[data-facts]");
  // Cut down to the lines that fit, or to none, the facts still scroll to their whole height.
  const whole = facts ? Math.max(facts.offsetHeight, facts.scrollHeight) : 0;
  if (!whole) return 0;
  const style = window.getComputedStyle(box);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  return whole + padding + border;
}
