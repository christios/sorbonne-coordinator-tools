/**
 * How tall a class's box has to be to show all of what it says (see ClassFacts): the
 * facts' own height, measured, and the box's padding and border round them. Nought where
 * nothing was laid out, as in a test.
 */
export function heightNeeded(box: HTMLElement): number {
  const facts = box.querySelector<HTMLElement>("[data-facts]");
  if (!facts || !facts.offsetHeight) return 0;
  const style = window.getComputedStyle(box);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  return facts.offsetHeight + padding + border;
}
