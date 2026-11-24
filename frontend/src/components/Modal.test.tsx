import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DateField } from "@/components/DateField";
import { Modal } from "@/components/Modal";

describe("a dialog", () => {
  it("has a close button in its corner, which closes it", () => {
    // Escape and a click outside always closed it; neither can be found by looking.
    const onClose = vi.fn();
    render(
      <Modal open title="CRN 23665" onClose={onClose}>
        <p>Who teaches it</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** A press as a mouse makes one: down, up and click, each going all the way through the page. */
function press(element: Element) {
  // jsdom has no PointerEvent: a mouse event of that name carries the button the calendar
  // reads to wait for the click.
  element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  fireEvent.mouseDown(element, { button: 0 });
  element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

describe("a press in a dialog (24 Nov 2026)", () => {
  it("folds a calendar open in the dialog away when somewhere else in it is pressed, and keeps the dialog open", async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Semester settings" onClose={onClose}>
        <DateField label="Week 1" value="2027-01-25" onChange={() => {}} />
        <p>Holidays</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Week 1" }));
    expect(screen.getByRole("grid", { name: "Week 1 calendar" })).toBeTruthy();
    await settle();

    press(screen.getByText("Holidays"));
    await settle();

    expect(screen.queryByRole("grid", { name: "Week 1 calendar" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the dialog only on the dimmed backdrop, and only the top one of two", () => {
    const below = vi.fn();
    const above = vi.fn();
    render(
      <Modal open title="Course record" onClose={below}>
        <p>Who teaches it</p>
        <Modal open title="CRN record" onClose={above}>
          <p>Its students</p>
        </Modal>
      </Modal>,
    );

    fireEvent.mouseDown(screen.getByText("Its students"));
    fireEvent.mouseDown(screen.getByText("Who teaches it"));
    expect(above).not.toHaveBeenCalled();
    expect(below).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "CRN record" }).parentElement as Element);
    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });
});
