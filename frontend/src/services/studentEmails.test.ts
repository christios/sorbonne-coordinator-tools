import { describe, expect, it } from "vitest";

import { asMailList, emailsFor } from "@/services/studentEmails";

const inSection = [{ studentId: "A001" }, { studentId: "A002" }, { studentId: "A003" }];

describe("emailsFor", () => {
  it("keeps the order the list shows", () => {
    const held = { A001: "one@sorbonne.ae", A002: "two@sorbonne.ae", A003: "three@sorbonne.ae" };

    expect(emailsFor(inSection, held).found).toEqual(["one@sorbonne.ae", "two@sorbonne.ae", "three@sorbonne.ae"]);
  });

  it("says who this browser has no address for rather than dropping them", () => {
    const { found, missing } = emailsFor(inSection, { A001: "one@sorbonne.ae", A003: "  " });

    expect(found).toEqual(["one@sorbonne.ae"]);
    expect(missing).toEqual(["A002", "A003"]);
  });

  it("writes one address once, however it is capitalised", () => {
    const held = { A001: "one@sorbonne.ae", A002: "ONE@Sorbonne.ae", A003: "three@sorbonne.ae" };

    expect(emailsFor(inSection, held).found).toEqual(["one@sorbonne.ae", "three@sorbonne.ae"]);
  });
});

describe("asMailList", () => {
  it("joins with semicolons, which is what Outlook reads as a separator", () => {
    expect(asMailList(["one@sorbonne.ae", "two@sorbonne.ae"])).toBe("one@sorbonne.ae; two@sorbonne.ae");
  });
});
