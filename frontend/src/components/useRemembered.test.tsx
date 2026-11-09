import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useRemembered } from "@/components/useRemembered";

function Holder({ name }: { name: string }) {
  const [value, setValue] = useRemembered("schema-term");
  return (
    <button type="button" aria-label={name} onClick={() => setValue(`${name}-choice`)}>
      {value || "nothing"}
    </button>
  );
}

afterEach(() => window.localStorage.clear());

/*
 * The semester chosen in the header moves the page already on screen, not only the next one
 * opened: every holder of the same remembered choice follows a change made by any of them.
 */
describe("a remembered choice", () => {
  it("is followed at once by every page holding it", () => {
    render(
      <>
        <Holder name="header" />
        <Holder name="page" />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "header" }));

    expect(screen.getByRole("button", { name: "page" }).textContent).toBe("header-choice");
    expect(window.localStorage.getItem("scen-remembered:schema-term")).toBe("header-choice");
  });

  it("follows another tab of the same browser", () => {
    render(<Holder name="page" />);

    act(() => {
      window.localStorage.setItem("scen-remembered:schema-term", "elsewhere");
      window.dispatchEvent(new StorageEvent("storage", { key: "scen-remembered:schema-term" }));
    });

    expect(screen.getByRole("button", { name: "page" }).textContent).toBe("elsewhere");
  });
});
