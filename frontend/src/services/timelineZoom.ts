/**
 * The two zooms of the department's week, as the range a slider runs over — shared by the
 * Semester Timetable and the semester plan, so the two grids are steered the same way.
 *
 * Width is in SCREENS: at 1 the week is exactly as wide as the room it has, and every
 * notch above that is a wider week you scroll. Expressed in pixels per minute instead, the
 * bottom half of the slider did nothing on a wide monitor, because anything narrower than
 * the screen was drawn at screen width anyway.
 *
 * Height is a share of the way from the whole week on the screen (0) to every box saying
 * everything (1), so every notch makes the classes taller (see `WeekTimeline`). It was a
 * class's height in pixels, and on a narrow week nearly all of the slider did nothing; a
 * height kept from then is past the top, and opens there, as the boxes did.
 */
export const WIDTH = { min: 1, max: 6, step: 0.1, start: 1 };
/*
 * At the lowest notch of either, that axis is squeezed rather than zoomed: the whole week on
 * the screen with nothing to scroll, the boxes cut down to what fits (see `WeekTimeline`).
 */
export const HEIGHT = { min: 0, max: 1, step: 0.02, start: 1 };
