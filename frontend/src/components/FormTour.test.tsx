import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormTour, type TourStep } from "@/components/FormTour";

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

  it("lets a press reach only the lit part: elsewhere it does nothing but shake the card and say why", () => {
    const lit = placed(300, 400, 120, 24);
    // Outside the lit part, in the window that holds the form: its close button, say.
    const window_ = document.createElement("div");
    window_.setAttribute("role", "dialog");
    window_.setAttribute("aria-modal", "true");
    const outside = document.createElement("button");
    window_.appendChild(outside);
    document.body.appendChild(window_);
    const pressed = vi.fn();
    outside.addEventListener("click", pressed);
    lit.addEventListener("click", pressed);
    render(<FormTour steps={[{ id: "one", title: "First", body: "", target: () => lit }]} at={0} onStep={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.mouseDown(outside, { clientX: 20, clientY: 20 });
    fireEvent.click(outside, { clientX: 20, clientY: 20, detail: 1 });
    expect(pressed).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("only the lit part works");
    expect(document.querySelector("[data-tour-card] .tour-card-shake")).not.toBeNull();

    fireEvent.click(lit, { clientX: 320, clientY: 410, detail: 1 });
    expect(pressed).toHaveBeenCalledTimes(1);
    // Enter on a focused control is a click with no place: it is not held back.
    fireEvent.click(outside, { detail: 0 });
    expect(pressed).toHaveBeenCalledTimes(2);
    lit.remove();
    window_.remove();
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
});
