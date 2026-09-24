/*
 * `node --test extension/filter-schema.test.mjs`
 *
 * What may leave the portal, and what may be asked of it. No framework, for the reason
 * timetable.test.mjs gives.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkFilter, mayReturn } from "./filter-schema.js";

test("a student's mobile leaves the portal, by its own key", () => {
  assert.equal(mayReturn("MOBILE_NO"), true);
  // Whatever the grid calls the column: the label would otherwise refuse it.
  assert.equal(mayReturn("MOBILE_NO", "Mobile No"), true);
});

test("every other contact and identity field is still refused", () => {
  for (const key of ["PASSPORT_ID", "DOB_CHAR", "PERS_EMAIL", "BALANCE", "ORACLE_ID", "PHONE_NO"]) {
    assert.equal(mayReturn(key), false, key);
  }
  // A mobile that is not the student's own is caught by the substring rule, as before.
  assert.equal(mayReturn("PARENT_MOBILE"), false);
  assert.equal(mayReturn("GUARDIAN_CONTACT", "Guardian Mobile"), false);
});

test("nobody can find a student by their number", () => {
  assert.equal(checkFilter({ MOBILE_NO: ["0501234567"] }, []), "sensitive_field:MOBILE_NO");
});

test("the columns everybody already had are unchanged", () => {
  for (const key of ["SPRIDEN_ID", "FULL_NAME", "PSUAD_EMAIL", "MAJOR_CODE", "STST_CODE"]) {
    assert.equal(mayReturn(key), true, key);
  }
});
