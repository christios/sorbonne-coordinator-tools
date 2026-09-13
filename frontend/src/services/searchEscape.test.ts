import { afterEach, describe, expect, it, vi } from "vitest";

import { installSearchEscape } from "@/services/searchEscape";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Escape in a search box", () => {
  it("drops focus, keeps the text, and lets nothing else see the key", () => {
    const uninstall = installSearchEscape();
    const box = document.createElement("input");
    box.type = "search";
    box.value = "maaz";
    document.body.appendChild(box);
    box.focus();
    const dialog = vi.fn();
    document.addEventListener("keydown", dialog);

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    box.dispatchEvent(event);

    expect(document.activeElement).not.toBe(box);
    expect(box.value).toBe("maaz");
    expect(event.defaultPrevented).toBe(true);
    expect(dialog).not.toHaveBeenCalled();

    // With nothing focused, the next Escape reaches the dialog.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(dialog).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", dialog);
    uninstall();
  });

  it("leaves other boxes and other keys alone", () => {
    const uninstall = installSearchEscape();
    const box = document.createElement("input");
    box.type = "text";
    document.body.appendChild(box);
    box.focus();

    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(box);
    uninstall();
  });
});
