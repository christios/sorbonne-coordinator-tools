import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyPresetMenu } from "@/components/CopyPresetMenu";
import { loadPresets, savePresets } from "@/services/copyPresets";
import type { StudentColumn } from "@/services/studentColumns";

const column = (id: string, displayName: string) =>
  ({ id, displayName, accessor: () => "" }) as unknown as StudentColumn;

const COLUMNS = [
  column("studentId", "Id"),
  column("portal:FULL_NAME", "Student Name"),
  column("portal:PSUAD_EMAIL", "E-mail"),
  column("cohort", "Cohort"),
];

/** What the menu asked to be copied, so the test can read it back. */
let asked: { columns: string[]; withHeader: boolean }[] = [];

function renderMenu(onCopy?: () => Promise<boolean>) {
  asked = [];
  return render(
    <CopyPresetMenu
      columns={COLUMNS}
      onCopy={async (chosen, withHeader) => {
        asked.push({ columns: chosen.map((c) => c.displayName), withHeader });
        return onCopy ? onCopy() : true;
      }}
    />,
  );
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the copy preset menu", () => {
  it("says what a preset is for when there are none yet", async () => {
    renderMenu();
    openMenu();

    expect(await screen.findByText(/copies the same columns every time/)).toBeTruthy();
  });

  it("makes a preset in a dialog, and lists it afterwards", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Preset name"), { target: { value: "Mail merge" } });
    fireEvent.click(within(dialog).getByLabelText("Id"));
    fireEvent.click(within(dialog).getByLabelText("E-mail"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Save 2 columns/ }));

    openMenu();
    expect(await screen.findByText("Mail merge")).toBeTruthy();
    expect(await screen.findByText("Id, E-mail")).toBeTruthy();
  });

  it("copies the preset's columns in the order they were ticked", async () => {
    savePresets({
      presets: [{ id: "p1", name: "Backwards", columnIds: ["portal:PSUAD_EMAIL", "studentId"] }],
      withHeader: false,
    });
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByText("Backwards"));

    expect(asked).toEqual([{ columns: ["E-mail", "Id"], withHeader: false }]);
  });

  it("carries the header setting through to the copy", async () => {
    savePresets({ presets: [{ id: "p1", name: "Ids", columnIds: ["studentId"] }], withHeader: false });
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByLabelText("Include a header row"));

    fireEvent.click(await screen.findByText("Ids"));

    expect(asked).toEqual([{ columns: ["Id"], withHeader: true }]);
  });

  it("remembers the header setting for next time", async () => {
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByLabelText("Include a header row"));

    expect(loadPresets().withHeader).toBe(true);
  });

  /*
   * A copy that worked looks exactly like one that silently did not, and there is no way
   * to check without leaving the page.
   */
  it("confirms a copy that worked", async () => {
    savePresets({ presets: [{ id: "p1", name: "Ids", columnIds: ["studentId"] }], withHeader: false });
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByText("Ids"));

    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  /*
   * Where the clipboard API is refused — a coordinator on plain http, or a browser that
   * denies the permission — the copy falls back to putting a textarea on the page and
   * selecting it. That takes the focus out of the menu, and the menu closed on it: the
   * copy dismissed its own confirmation, so a copy that worked looked like nothing
   * happening at all. Found on the real thing; jsdom's clipboard never refuses.
   */
  it("stays open when the copy takes the focus, so the tick can be seen", async () => {
    savePresets({ presets: [{ id: "p1", name: "Ids", columnIds: ["studentId"] }], withHeader: false });
    render(
      <CopyPresetMenu
        columns={COLUMNS}
        onCopy={async () => {
          // What the fallback does: a textarea on the page, focused, then taken away.
          const holder = document.createElement("textarea");
          document.body.appendChild(holder);
          holder.focus();
          document.body.removeChild(holder);
          return true;
        }}
      />,
    );
    openMenu();

    fireEvent.click(await screen.findByText("Ids"));

    expect(await screen.findByText("Copied")).toBeTruthy();
    // Still there to be read, rather than dismissed by its own copy.
    expect(screen.getByRole("button", { name: /New preset/ })).toBeTruthy();
  });

  it("says so when the browser refused the clipboard", async () => {
    savePresets({ presets: [{ id: "p1", name: "Ids", columnIds: ["studentId"] }], withHeader: false });
    renderMenu(async () => false);
    openMenu();

    fireEvent.click(await screen.findByText("Ids"));

    expect(await screen.findByText(/would not let us copy/)).toBeTruthy();
  });

  it("does not try to copy a preset whose columns have all gone", async () => {
    savePresets({ presets: [{ id: "p1", name: "Stale", columnIds: ["portal:GONE"] }], withHeader: false });
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByText("Stale"));

    expect(asked).toEqual([]);
    expect(await screen.findByText(/exist any more/)).toBeTruthy();
  });

  it("edits a preset's columns without making a second one", async () => {
    savePresets({ presets: [{ id: "p1", name: "Ids", columnIds: ["studentId"] }], withHeader: false });
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Edit the Ids preset" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Cohort"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Save 2 columns/ }));

    const held = loadPresets().presets;
    expect(held).toHaveLength(1);
    expect(held[0].columnIds).toEqual(["studentId", "cohort"]);
  });

  it("deletes a preset", async () => {
    savePresets({ presets: [{ id: "p1", name: "Ids", columnIds: ["studentId"] }], withHeader: false });
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByRole("button", { name: "Delete the Ids preset" }));

    expect(loadPresets().presets).toEqual([]);
  });

  it("will not save a preset without a name or without columns", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("button", { name: /Pick some columns/ }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(within(dialog).getByLabelText("Id"));
    expect(within(dialog).getByRole("button", { name: /Save 1 column/ }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Preset name"), { target: { value: "Ids" } });
    expect(within(dialog).getByRole("button", { name: /Save 1 column/ }).hasAttribute("disabled")).toBe(false);
  });

  it("offers columns the table is not showing, which is the point of a preset", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));

    const dialog = await screen.findByRole("dialog");
    // Every column that exists, not the visible subset.
    for (const name of ["Id", "Student Name", "E-mail", "Cohort"]) {
      expect(within(dialog).getByLabelText(name)).toBeTruthy();
    }
  });

  /*
   * Columns copy in the order they were picked, which is rarely the order they are
   * wanted in — and re-ticking everything to change it is not an answer.
   */
  it("reorders the picked columns by dragging one onto another", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Preset name"), { target: { value: "Merge" } });
    fireEvent.click(within(dialog).getByLabelText("Id"));
    fireEvent.click(within(dialog).getByLabelText("E-mail"));

    // Drag the e-mail chip onto the id chip: it lands in front of it.
    const chips = within(dialog).getAllByRole("listitem");
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      setData: (kind: string, value: string) => data.set(kind, value),
      getData: (kind: string) => data.get(kind) ?? "",
    };
    fireEvent.dragStart(chips[1], { dataTransfer });
    fireEvent.dragOver(chips[0], { dataTransfer });
    fireEvent.drop(chips[0], { dataTransfer });

    fireEvent.click(within(dialog).getByRole("button", { name: /Save 2 columns/ }));
    expect(loadPresets().presets[0].columnIds).toEqual(["portal:PSUAD_EMAIL", "studentId"]);
  });

  it("reorders without a mouse, for anyone who cannot drag", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Preset name"), { target: { value: "Merge" } });
    fireEvent.click(within(dialog).getByLabelText("Id"));
    fireEvent.click(within(dialog).getByLabelText("E-mail"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Move E-mail earlier" }));

    fireEvent.click(within(dialog).getByRole("button", { name: /Save 2 columns/ }));
    expect(loadPresets().presets[0].columnIds).toEqual(["portal:PSUAD_EMAIL", "studentId"]);
  });

  it("takes a column out from its chip", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Id"));
    fireEvent.click(within(dialog).getByLabelText("E-mail"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Take Id out" }));

    expect(within(dialog).getByRole("button", { name: /Save 1 column/ })).toBeTruthy();
    // The tick box follows it, rather than claiming it is still picked.
    expect((within(dialog).getByLabelText("Id") as HTMLInputElement).checked).toBe(false);
  });

  it("narrows a long column list by searching it", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: /New preset/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Search columns"), { target: { value: "mail" } });

    expect(within(dialog).getByLabelText("E-mail")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Cohort")).toBeNull();
  });
});
