import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScopeDialog, WeekPicker } from "@/components/PlanDialogs";

describe("the question a change to a repeating class asks", () => {
  const ask = (week: number, onChoose = vi.fn()) =>
    render(
      <ScopeDialog
        open
        verb="change"
        when="Tuesday 19 Jan"
        week={week}
        firstWeek={1}
        count={14}
        movedApart={2}
        busy={false}
        onChoose={onChoose}
        onClose={() => {}}
      />,
    );

  it("offers this and the following only after the series' first week", () => {
    const { unmount } = ask(1);
    expect(screen.queryByRole("radio", { name: /following/ })).toBeNull();
    unmount();
    ask(3);
    expect(screen.getByRole("radio", { name: /following/ })).toBeTruthy();
  });

  it("says that the whole series puts the classes changed on their own back in line", () => {
    ask(3);
    expect(screen.getByRole("radio", { name: /All classes/ }).textContent).toContain("2 changed on their own will follow");
  });

  it("answers this class unless told otherwise", () => {
    const onChoose = vi.fn();
    ask(3, onChoose);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChoose).toHaveBeenCalledWith("one");
    fireEvent.click(screen.getByRole("radio", { name: /following/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChoose).toHaveBeenLastCalledWith("following");
  });
});

describe("the weeks a class meets in", () => {
  it("takes the odd weeks in one press, and a week on or off in another", () => {
    const onChange = vi.fn();
    render(<WeekPicker count={6} value={[1, 2]} onChange={onChange} dateOf={() => "11 Jan"} />);
    fireEvent.click(screen.getByRole("button", { name: "Odd weeks" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 5]);
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 4]);
  });
});
