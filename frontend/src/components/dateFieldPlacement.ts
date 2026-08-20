export type CalendarPlacement = {
  side: "top" | "bottom";
  maxHeight: number;
};

const CALENDAR_PREFERRED_HEIGHT = 336;
const VIEWPORT_EDGE_PADDING = 8;

/** Chooses one stable, visible side for the calendar before it opens. */
export function chooseCalendarPlacement({
  availableAbove,
  availableBelow,
}: {
  availableAbove: number;
  availableBelow: number;
}): CalendarPlacement {
  const maxHeight = (availableHeight: number) => Math.max(0, availableHeight - VIEWPORT_EDGE_PADDING);

  if (availableBelow >= CALENDAR_PREFERRED_HEIGHT + VIEWPORT_EDGE_PADDING) {
    return { side: "bottom", maxHeight: maxHeight(availableBelow) };
  }
  if (availableAbove >= CALENDAR_PREFERRED_HEIGHT + VIEWPORT_EDGE_PADDING) {
    return { side: "top", maxHeight: maxHeight(availableAbove) };
  }

  return availableBelow >= availableAbove
    ? { side: "bottom", maxHeight: maxHeight(availableBelow) }
    : { side: "top", maxHeight: maxHeight(availableAbove) };
}
