/*
 * `node --test extension/timetable.test.mjs`
 *
 * No framework and no dependency: two pure functions, and Node has had a test runner
 * since 18. The alternative was pulling the extension into the frontend's vitest project,
 * which would make a browser extension a dependency of a React build for the sake of
 * eleven assertions.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { collapse, headCount } from "./timetable.js";

/** One row as the service answers: a student, and a meeting they are in. */
const row = (over = {}) => ({
  COURSE_CRN: "23436",
  COURSE_CODE: "MATH-351",
  COURSE_TITLE: "Analysis",
  ROOM_CODE: "Room: 5.111",
  EVEN_START: "2026-10-26 08:15:00",
  EVENT_END: "2026-10-26 10:15:00",
  TEACHER_NAME: "Omar El Dakkak",
  ...over,
});

test("one row per student and meeting becomes one row per meeting", () => {
  // What a lecture of three actually looks like on the wire.
  const { meetings } = collapse([row(), row(), row()]);

  assert.equal(meetings.length, 1);
  assert.deepEqual(
    { ...meetings[0], seen: undefined },
    { meetsOn: "2026-10-26", startsAt: "08:15", endsAt: "10:15", room: "5.111", seen: undefined },
  );
});

test("the room loses the portal's label and keeps the room", () => {
  assert.equal(collapse([row()]).meetings[0].room, "5.111");
  assert.equal(collapse([row({ ROOM_CODE: "room:  A2.03 " })]).meetings[0].room, "A2.03");
  // A class with no room booked is the thing this whole record exists to find.
  assert.equal(collapse([row({ ROOM_CODE: "" })]).meetings[0].room, "");
});

test("either separator, and the value is read as written", () => {
  const { meetings } = collapse([row({ EVEN_START: "2026-10-26T23:45:00", EVENT_END: "2026-10-27T01:15:00" })]);

  assert.equal(meetings[0].meetsOn, "2026-10-26");
  assert.equal(meetings[0].startsAt, "23:45");
  assert.equal(meetings[0].endsAt, "01:15");
});

test("the reading does not depend on the machine's timezone", () => {
  /*
   * Run in a far-off zone, in a child process, because that is the only way to make this
   * fail on every machine. Both sources are wall-clock Asia/Dubai and neither carries an
   * offset, so `new Date(...)` would attach whichever zone the laptop happens to be in —
   * and a class at 02:00 becomes a class on the previous day for a coordinator syncing
   * from Paris. Asserting it here in local time proves nothing: in UTC a Date-based
   * reading is accidentally right, and this test would pass on CI while the bug shipped.
   */
  const script = `
    import { collapse } from ${JSON.stringify(new URL("./timetable.js", import.meta.url).href)};
    const rows = [{ EVEN_START: "2026-10-26 02:00:00", EVENT_END: "2026-10-26 03:30:00", ROOM_CODE: "" }];
    process.stdout.write(JSON.stringify(collapse(rows).meetings[0]));
  `;
  const read = (zone) =>
    JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, TZ: zone },
        encoding: "utf8",
      }),
    );

  // +14 and -11: whichever way a Date would shift, one of these crosses midnight.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Midway", "UTC", "Asia/Dubai"]) {
    const meeting = read(zone);
    assert.equal(meeting.meetsOn, "2026-10-26", `meetsOn moved in ${zone}`);
    assert.equal(meeting.startsAt, "02:00", `startsAt moved in ${zone}`);
    assert.equal(meeting.endsAt, "03:30", `endsAt moved in ${zone}`);
  }
});

test("an unreadable time is counted, never quietly dropped", () => {
  /*
   * `_overlap` on the server wraps its parsing in `except ValueError`, so an unparseable
   * time becomes "no clash" and is invisible at compare time. It has to be loud here or
   * it is never caught anywhere.
   */
  const { meetings, malformed } = collapse([row(), row({ EVEN_START: "" }), row({ EVENT_END: "soon" })]);

  assert.equal(malformed, 2);
  assert.equal(meetings.length, 1);
});

test("a section with nothing readable produces no meetings and no section body", () => {
  const { meetings, section, malformed } = collapse([row({ EVEN_START: "n/a", EVENT_END: "n/a" })]);

  assert.equal(meetings.length, 0);
  assert.equal(malformed, 1);
  // Nothing to describe the section with, so nothing is invented for it.
  assert.equal(section, null);
});

test("the head count is how many rows a meeting was returned for", () => {
  const three = collapse([row(), row(), row()]).meetings;
  assert.deepEqual(headCount(three), { headCount: 3, headCountLow: null, headCountHigh: null });
});

test("meetings that disagree give no single number rather than an average", () => {
  // Somebody added mid-term: 3 in the first meeting, 2 in the second. There is no one
  // number that is true of the section, and inventing one is worse than saying so.
  const rows = [
    row(), row(), row(),
    row({ EVEN_START: "2026-11-02 08:15:00", EVENT_END: "2026-11-02 10:15:00" }),
    row({ EVEN_START: "2026-11-02 08:15:00", EVENT_END: "2026-11-02 10:15:00" }),
  ];
  const { meetings } = collapse(rows);

  assert.equal(meetings.length, 2);
  assert.deepEqual(headCount(meetings), { headCount: null, headCountLow: 2, headCountHigh: 3 });
});

test("no meetings means no head count, and no division to get wrong", () => {
  // A meeting key exists only because a row produced it, so a zero denominator is
  // structurally impossible rather than guarded against.
  assert.deepEqual(headCount([]), { headCount: null, headCountLow: null, headCountHigh: null });
});

test("the section is described from the first readable row", () => {
  const { section } = collapse([row({ COURSE_CODE: "MATH-351", TEACHER_NAME: "Omar El Dakkak" })]);

  assert.deepEqual(section, { courseCode: "MATH-351", title: "Analysis", teacherName: "Omar El Dakkak" });
});
