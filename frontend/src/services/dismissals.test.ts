import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDismissed,
  dismiss,
  familyOf,
  loadDismissed,
  pruneDismissed,
  restore,
  restoreMany,
} from "@/services/dismissals";

const RULE = "A001:rule-1:WD";
const ARRIVAL = "cohort-2:A001:rule-1:MATH:cohort-1";
const REGISTRATION = "registration|A001|262710|PHYS-118|missing|22150|";

beforeEach(() => window.localStorage.clear());

describe("which family a key belongs to", () => {
  it("reads the family from the key, and an unprefixed key is a rule", () => {
    expect(familyOf(REGISTRATION)).toBe("registration");
    expect(familyOf(RULE)).toBe("rule");
    // An arrival is a rule warning judged from another cohort's side. It carries a cohort
    // id where a rule warning carries a student id, and neither is prefixed.
    expect(familyOf(ARRIVAL)).toBe("rule");
  });
});

describe("pruning dismissals whose warning is gone", () => {
  it("drops a dismissal of its own family that nothing points at any more", () => {
    dismiss(RULE);
    expect(pruneDismissed([], "rule").has(RULE)).toBe(false);
  });

  it("keeps a dismissal of its own family that is still live", () => {
    dismiss(RULE);
    expect(pruneDismissed([RULE], "rule").has(RULE)).toBe(true);
  });

  it("never touches another family's dismissals", () => {
    // The bug this replaces: the Cohorts page said "mine is anything that is not a
    // registration key", so the first page to prune swallowed every family nobody had
    // taught it about — including any added later.
    dismiss(REGISTRATION);
    dismiss(RULE);

    const afterCohorts = pruneDismissed([RULE], "rule");
    expect(afterCohorts.has(REGISTRATION)).toBe(true);

    const afterRegister = pruneDismissed([REGISTRATION], "registration");
    expect(afterRegister.has(RULE)).toBe(true);
  });
});

describe("bringing dismissals back", () => {
  it("restores only the keys it is given", () => {
    dismiss(RULE);
    dismiss(ARRIVAL);
    dismiss(REGISTRATION);

    const left = restoreMany([RULE, ARRIVAL]);

    expect(left.has(RULE)).toBe(false);
    expect(left.has(ARRIVAL)).toBe(false);
    expect(left.has(REGISTRATION)).toBe(true);
    expect(loadDismissed().has(REGISTRATION)).toBe(true);
  });

  it("empties the store when everything is brought back", () => {
    dismiss(RULE);
    dismiss(REGISTRATION);

    expect(clearDismissed().size).toBe(0);
    expect(loadDismissed().size).toBe(0);
  });

  it("restores one at a time as it always did", () => {
    dismiss(RULE);
    expect(restore(RULE).has(RULE)).toBe(false);
  });
});
