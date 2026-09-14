import { describe, expect, it } from "vitest";

import { isWebLink, linkHost } from "./timeSheetLinks";

describe("isWebLink", () => {
  it("takes the share link OneDrive gives, however long", () => {
    expect(isWebLink("https://sorbonne-my.sharepoint.com/:x:/g/personal/a/EabcD?e=5&nav=x")).toBe(true);
    expect(isWebLink("  https://example.org/sheet.xlsx  ")).toBe(true);
    expect(isWebLink("http://intranet/sheet")).toBe(true);
  });

  it("refuses anything that is not a web address", () => {
    // The one that matters: this would run as script from the teacher's profile.
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    // The one that happens: the path copied out of Explorer instead of the share link.
    expect(isWebLink("C:\\Users\\me\\time sheet.xlsx")).toBe(false);
    expect(isWebLink("sorbonne-my.sharepoint.com/x")).toBe(false);
    expect(isWebLink("")).toBe(false);
  });
});

describe("linkHost", () => {
  it("names where a link goes, and says nothing when it cannot", () => {
    expect(linkHost("https://www.sorbonne-my.sharepoint.com/:x:/g/a")).toBe("sorbonne-my.sharepoint.com");
    expect(linkHost("not a link")).toBe("");
  });
});
