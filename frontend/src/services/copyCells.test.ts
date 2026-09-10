import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTable, tableHtml } from "@/services/copyCells";

afterEach(() => vi.unstubAllGlobals());

describe("a block that pastes as a table in an email too", () => {
  it("writes both flavours, so each reader takes the one it understands", async () => {
    /*
     * A spreadsheet reads tab-separated text and makes a table of it; an email does not —
     * it keeps the tabs and shows a column of ragged lines, which is what pasting the
     * registrar's worklist into a message got.
     */
    let offered: Record<string, Blob> = {};
    class FakeItem {
      constructor(public parts: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeItem);
    vi.stubGlobal("navigator", {
      clipboard: { write: async (items: FakeItem[]) => void (offered = items[0].parts) },
    });

    const done = await copyTable(["Student ID", "Action"], [["A001", "Add"]]);

    expect(done).toBe(true);
    // The two flavours, by type. What is IN each is `tableHtml` and `tableText`, which are
    // pure and asserted on their own below — this jsdom's Blob cannot be read back.
    expect(Object.keys(offered).sort()).toEqual(["text/html", "text/plain"]);
    expect(offered["text/html"].type).toBe("text/html");
    expect(offered["text/plain"].type).toBe("text/plain");
  });

  it("falls back to the text alone where the browser will not take two flavours", async () => {
    // Plain http has no clipboard API at all, and the text still pastes into a sheet.
    const written: string[] = [];
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void written.push(text) } });

    const done = await copyTable(["A"], [["1"]]);

    expect(done).toBe(true);
    expect(written).toEqual(["A\n1"]);
  });

  it("writes the table an email reads, header row included", () => {
    const html = tableHtml(["Student ID", "Action"], [["A001", "Add"]]);

    expect(html).toContain("<th>Student ID</th>");
    expect(html).toContain("<td>A001</td>");
    expect(html).toContain("border-collapse:collapse");
  });

  it("leaves out the header row when the copy was asked for without one", () => {
    // A preset saved with the header off is pasted under a heading somebody has already
    // written; repeating the column names underneath it is noise in both flavours.
    const written: string[] = [];
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void written.push(text) } });

    const html = tableHtml(null, [["A001", "Add"]]);

    expect(html).not.toContain("<thead>");
    expect(html).toContain("<td>A001</td>");
    return copyTable(null, [["A001", "Add"]]).then(() => expect(written).toEqual(["A001\tAdd"]));
  });

  it("escapes what would otherwise be markup, and keeps an empty cell a cell", () => {
    // A course note carrying "<" or "&" must not close the table it is inside, and a blank
    // cell with nothing in it collapses in a mail client unless it is given something.
    const html = tableHtml(["Note"], [["Maths & <Physics>"], [""]]);

    expect(html).toContain("Maths &amp; &lt;Physics&gt;");
    expect(html).toContain("<td>&nbsp;</td>");
  });
});
