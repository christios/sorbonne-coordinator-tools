import { describe, expect, it } from "vitest";

import { scrollCues, type PaneMetrics } from "@/components/useScrollCues";

// A pane 300px high, holding 570px, with a 40px sticky heading and a 30px sticky foot.
const PANE: PaneMetrics = {
  scrollTop: 0,
  scrollHeight: 570,
  clientHeight: 300,
  scrollLeft: 0,
  scrollWidth: 600,
  clientWidth: 600,
  offsetHeight: 302,
  offsetWidth: 602,
  clientTop: 1,
  clientLeft: 1,
  head: 40,
  foot: 30,
  stickyColumn: 0,
};

describe("what a scrolling pane says is out of sight", () => {
  it("fades the foot only, at the top", () => {
    const cues = scrollCues(PANE);

    expect(cues).toMatchObject({ up: false, down: true, left: false, right: false });
    // The cues sit between the sticky heading and foot, inside the border.
    expect(cues.insetTop).toBe(41);
    expect(cues.insetBottom).toBe(31);
  });

  it("fades both ends once scrolled, and the heading only at the bottom", () => {
    expect(scrollCues({ ...PANE, scrollTop: 150 })).toMatchObject({ up: true, down: true });
    expect(scrollCues({ ...PANE, scrollTop: 270 })).toMatchObject({ up: true, down: false });
  });

  it("says nothing when everything fits", () => {
    expect(scrollCues({ ...PANE, scrollHeight: 300 })).toMatchObject({ up: false, down: false, left: false, right: false });
  });

  it("points sideways at columns out of sight, past the column that stays put", () => {
    const cues = scrollCues({ ...PANE, scrollWidth: 700, scrollLeft: 50, stickyColumn: 128 });

    expect(cues).toMatchObject({ left: true, right: true, insetLeft: 129 });
  });
});
