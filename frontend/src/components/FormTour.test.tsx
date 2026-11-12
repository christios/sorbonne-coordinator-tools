import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormTour, readingTime, tally, tourPace, type TourStep } from "@/components/FormTour";
import { Tip } from "@/components/InfoTip";

/** A control with a place on the screen, as a browser would give it. */
function placed(left: number, top: number, width: number, height: number): HTMLElement {
  const element = document.createElement("button");
  document.body.appendChild(element);
  element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  return element;
}

describe("a guided tour's card", () => {
  it("points an arrow at the control a step asks to try", () => {
    const toggle = placed(300, 400, 120, 24);
    const steps: TourStep[] = [{ id: "one", title: "How much it matters", body: "Choose.", tryIt: "Choose Must.", target: () => toggle, pointAt: () => toggle }];
    render(<FormTour steps={steps} at={0} onStep={() => {}} onClose={() => {}} />);
    const arrow = document.querySelector<HTMLElement>("[data-tour-arrow]");
    expect(arrow).not.toBeNull();
    expect(arrow!.dataset.tourArrow).toBe("above");
    // Over the control, pointing down at its middle.
    expect(arrow!.style.left).toBe(`${300 + 60 - 14}px`);
    expect(arrow!.style.top).toBe(`${400 - 34}px`);
    toggle.remove();
  });

  it("puts the arrow to the left of the control when the step asks, pointing right at it", () => {
    const toggle = placed(300, 400, 220, 24);
    const steps: TourStep[] = [{ id: "one", title: "How much it matters", body: "", target: () => toggle, pointAt: () => toggle, pointFrom: "left" }];
    render(<FormTour steps={steps} at={0} onStep={() => {}} onClose={() => {}} />);
    const arrow = document.querySelector<HTMLElement>("[data-tour-arrow]");
    expect(arrow!.dataset.tourArrow).toBe("left");
    expect(arrow!.style.left).toBe(`${300 - 36}px`);
    expect(arrow!.style.top).toBe(`${400 + 12 - 14}px`);
    toggle.remove();
  });

  it("says Your turn under the instructions, and Nicely done in its very place once done", () => {
    const steps = (done: boolean): TourStep[] => [
      { id: "zero", title: "Zero" },
      { id: "one", title: "First", steps: ["Press it."], tryIt: "Press it.", done },
      { id: "two", title: "Second" },
    ];
    const { rerender } = render(<FormTour steps={steps(false)} at={1} onStep={() => {}} onClose={() => {}} />);
    const card = () => screen.getByRole("dialog", { name: "Guided tour: First" });
    const slot = () => card().querySelector<HTMLElement>("[data-tour-slot]");
    // Right under the numbered steps, before the row of buttons; nothing to press there yet.
    expect(slot()?.dataset.tourSlot).toBe("todo");
    expect(slot()?.textContent).toBe("Your turn");
    expect(slot()?.previousElementSibling?.tagName).toBe("OL");
    expect(within(card()).queryByRole("button", { name: "Next" })).toBeNull();
    rerender(<FormTour steps={steps(true)} at={1} onStep={() => {}} onClose={() => {}} />);
    expect(slot()?.dataset.tourSlot).toBe("done");
    expect(slot()?.textContent).toBe("Nicely done");
    expect(slot()?.className).toContain("tour-slot-done");
    expect(slot()?.previousElementSibling?.tagName).toBe("OL");
    // The same line, one height either way; and the row under it as tall with Next as without.
    expect(slot()?.className).toContain("min-h-9");
    expect(within(card()).getByRole("button", { name: "Next" }).parentElement?.parentElement?.className).toContain("min-h-8");
  });

  it("goes straight on when a step's try is done and it says so, with no Next and no Skip", () => {
    const onStep = vi.fn();
    const steps: TourStep[] = [
      { id: "one", title: "First", body: "", tryIt: "Do it.", done: false, instantNext: true },
      { id: "two", title: "Second", body: "" },
    ];
    const { rerender } = render(<FormTour steps={steps} at={0} onStep={onStep} onClose={() => {}} />);
    const card = screen.getByRole("dialog", { name: "Guided tour: First" });
    expect(within(card).queryByRole("button", { name: "Skip" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Next" })).toBeNull();
    rerender(<FormTour steps={[{ ...steps[0], done: true }, steps[1]]} at={0} onStep={onStep} onClose={() => {}} />);
    expect(onStep).toHaveBeenCalledWith(1);
    expect(screen.queryByText("Nicely done")).toBeNull();
  });

  it("lets a press reach only the controls the step is about: elsewhere, a large alert says not to fill in the form, then the card shakes", () => {
    const allowed = placed(300, 400, 120, 24);
    const lit = placed(300, 430, 120, 24);
    // Outside the lit part, in the window that holds the form: its close button, say.
    const window_ = document.createElement("div");
    window_.setAttribute("role", "dialog");
    window_.setAttribute("aria-modal", "true");
    const outside = document.createElement("button");
    window_.appendChild(outside);
    document.body.appendChild(window_);
    const pressed = vi.fn();
    for (const element of [allowed, lit, outside]) element.addEventListener("click", pressed);
    const steps: TourStep[] = [{ id: "one", title: "First", steps: ["Press it.", "Watch."], target: () => [allowed, lit], allow: () => allowed }];
    render(<FormTour steps={steps} at={0} onStep={() => {}} onClose={() => {}} />);
    // What to do, numbered.
    expect(within(screen.getByRole("dialog", { name: "Guided tour: First" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "11. Press it.",
      "22. Watch.",
    ]);
    expect(screen.queryByRole("status")).toBeNull();

    // Lit, but not what the step is about; then outside it; then from the keyboard.
    fireEvent.mouseDown(lit);
    fireEvent.click(lit);
    fireEvent.click(outside);
    fireEvent.click(outside, { detail: 0 });
    expect(pressed).not.toHaveBeenCalled();
    const alert = screen.getByRole("alertdialog", { name: "Don’t fill in the form now" });
    expect(alert.textContent).toContain("This is a guided tour. Just follow the steps on the green card.");
    expect(alert.textContent).toContain("Now: press Finish on the card.");
    // Its own button works; Escape too. Back on the card, it shakes and its button is called for.
    fireEvent.click(within(alert).getByRole("button", { name: "Back to the tour" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.querySelector("[data-tour-card] .tour-card-shake")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Finish" }).className).toContain("ring-4");
    fireEvent.mouseDown(outside);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "End the guided tour?" })).toBeNull();

    fireEvent.click(allowed);
    expect(pressed).toHaveBeenCalledTimes(1);
    allowed.remove();
    lit.remove();
    window_.remove();
  });

  it("lights parts apart when a step asks, the dim between them, a box overlapping the calendar cut once", () => {
    const calendar = placed(100, 100, 400, 300);
    // A box hanging below the calendar, its top inside it.
    const box = placed(150, 350, 200, 150);
    const steps: TourStep[] = [{ id: "one", title: "First", body: "", target: () => [[calendar], box], apart: true }];
    render(<FormTour steps={steps} at={0} onStep={() => {}} onClose={() => {}} />);
    expect(document.querySelectorAll("[data-tour-lit]")).toHaveLength(2);
    // The dim covers what is not lit, and nothing that is: not the calendar, not the box under it.
    const dimmed = (x: number, y: number) =>
      [...document.querySelectorAll<HTMLElement>("[data-tour-dim]")].filter((piece) => {
        const [left, top, width, height] = ["left", "top", "width", "height"].map((side) => parseFloat(piece.style.getPropertyValue(side)));
        return x >= left && x < left + width && y >= top && y < top + height;
      }).length;
    expect(dimmed(300, 200)).toBe(0);
    expect(dimmed(250, 480)).toBe(0);
    // Beside the box, under the calendar: the summary's place.
    expect(dimmed(450, 480)).toBe(1);
    expect(dimmed(20, 20)).toBe(1);
    expect(dimmed(250, 600)).toBe(1);
    calendar.remove();
    box.remove();
  });

  it("asks before it ends", () => {
    const onClose = vi.fn();
    render(<FormTour steps={[{ id: "one", title: "First", body: "" }]} at={0} onStep={() => {}} onClose={onClose} endWords="Nothing is lost." />);
    fireEvent.click(screen.getByRole("button", { name: "End the tour" }));
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("Nothing is lost.");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(sure).getByRole("button", { name: "End the tour" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("grows its arrow, ringed, when the page nudges it", () => {
    const toggle = placed(300, 400, 120, 24);
    const steps: TourStep[] = [{ id: "one", title: "First", tryIt: "Choose.", target: () => toggle, pointAt: () => toggle }];
    const { rerender } = render(<FormTour steps={steps} at={0} onStep={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-tour-arrow-call]")).toBeNull();
    rerender(<FormTour steps={steps} at={0} onStep={() => {}} onClose={() => {}} nudge={1} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the tour" }));
    const call = document.querySelector<HTMLElement>("[data-tour-arrow-call]");
    expect(call?.className).toContain("tour-arrow-call");
    // Away from the control it points down at: it grows upwards, never over it.
    expect(call?.style.transformOrigin).toBe("center bottom");
    toggle.remove();
  });

  it("shuts every hover bubble on the page while it is on", () => {
    const { rerender } = render(
      <Tip open content="What Whole day does">
        <button type="button">Whole day</button>
      </Tip>,
    );
    expect(screen.getAllByText("What Whole day does").length).toBeGreaterThan(0);
    rerender(
      <>
        <Tip open content="What Whole day does">
          <button type="button">Whole day</button>
        </Tip>
        <FormTour steps={[{ id: "one", title: "First" }]} at={0} onStep={() => {}} onClose={() => {}} />
      </>,
    );
    expect(screen.queryAllByText("What Whole day does")).toHaveLength(0);
  });
});

describe("a card's reading time", () => {
  afterEach(() => {
    vi.useRealTimers();
    tourPace.scale = 1;
  });
  const tick = (seconds: number) =>
    act(() => {
      vi.advanceTimersByTime(seconds * 1000);
    });

  it("holds Next until it has run out, saying so over a bar; not again on a step come back to", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const onStep = vi.fn();
    const steps: TourStep[] = [
      { id: "one", title: "First", steps: ["Read me."], readFor: 3 },
      { id: "two", title: "Second", steps: ["And me."] },
    ];
    const { rerender } = render(<FormTour steps={steps} at={0} onStep={onStep} onClose={() => {}} />);
    const timer = () => document.querySelector<HTMLElement>("[data-tour-timer]");
    expect(timer()?.textContent).toContain("Read this card first");
    expect(timer()?.textContent).toContain("next step in 3 s");
    const next = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    tick(2);
    expect(timer()?.textContent).toContain("next step in 1 s");
    expect(next().disabled).toBe(true);
    tick(1);
    // Run out: it folds away, with nothing more to say.
    expect(document.querySelector("[data-tour-timer-wrap]")?.getAttribute("data-state")).toBe("done");
    expect(document.querySelector("[data-tour-card]")?.textContent).not.toContain("Time's up");
    expect(next().disabled).toBe(false);
    fireEvent.click(next());
    expect(onStep).toHaveBeenCalledWith(1);
    // Come back to it: read already, no wait.
    rerender(<FormTour steps={steps} at={1} onStep={onStep} onClose={() => {}} />);
    rerender(<FormTour steps={steps} at={0} onStep={onStep} onClose={() => {}} />);
    expect(timer()).toBeNull();
    expect(next().disabled).toBe(false);
  });

  it("goes on from a step done only once it has run out", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const onStep = vi.fn();
    const steps = (done: boolean): TourStep[] => [
      { id: "one", title: "First", tryIt: "Do it.", done, instantNext: true, readFor: 4 },
      { id: "two", title: "Second" },
    ];
    const { rerender } = render(<FormTour steps={steps(false)} at={0} onStep={onStep} onClose={() => {}} />);
    tick(1);
    rerender(<FormTour steps={steps(true)} at={0} onStep={onStep} onClose={() => {}} />);
    expect(onStep).not.toHaveBeenCalled();
    expect(screen.getByText("Nicely done")).toBeTruthy();
    tick(3);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it("is none on a card that is only a suggestion", () => {
    render(<FormTour hint steps={[{ id: "welcome", title: "Take the tour?", readFor: 5, actions: [{ label: "Start", onClick: () => {} }] }]} at={0} onStep={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-tour-timer]")).toBeNull();
  });
});

describe("how long a card holds", () => {
  /** A control drawn in a card, as the form draws its buttons. */
  function Button({ children }: { children: string }) {
    return <span>{children}</span>;
  }
  Button.tourLook = 0;
  function Switch() {
    return <span>Constraint Preference</span>;
  }
  Switch.tourLook = 2;

  it("counts the words read, through the elements they sit in, and the controls named", () => {
    expect(
      tally([
        "Press Done.",
        <>
          Choose <Switch />, then press <Button>Done</Button> · now
        </>,
      ]),
    ).toEqual({ words: 2 + 1 + 2 + 2 + 1 + 1, controls: 2 });
    // A time is a word; a dash or a dot alone is not.
    expect(tally(["Tue 14:00–16:00 – ·"]).words).toBe(2);
  });

  it("grows with the words, the instructions and the controls, from 3 seconds to 15", () => {
    const short = readingTime({ title: "Open the block", steps: ["Click the block you made."] });
    const longer = readingTime({ title: "Open the block", steps: ["Click the block you made.", "Then look at it closely, and read what it says."] });
    const withControls = readingTime({
      title: "Open the block",
      steps: [
        "Click the block you made.",
        <>
          Then press <Button>Done</Button> and <Button>Next</Button>.
        </>,
      ],
    });
    expect(short).toBe(3);
    expect(longer).toBeGreaterThan(short);
    expect(withControls).toBeGreaterThan(readingTime({ title: "Open the block", steps: ["Click the block you made.", "Then press Done and Next."] }));
    expect(readingTime({ title: "Long", steps: Array.from({ length: 20 }, () => "Many words to read in this line, one after another.") })).toBe(15);
  });
});
