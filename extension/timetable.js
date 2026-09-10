'use strict';
/*
 * Turning the timetable service's answer into meetings, and nothing else.
 *
 * Pure on purpose, and in its own file so it can be run without a browser: this is where
 * the subtle mistakes live. One row per (student, meeting) collapsing to one row per
 * meeting is also the only moment the head counts exist, and a slip either way is
 * invisible afterwards — a lost meeting looks like a class that was never booked, and a
 * doubled one looks like a clash.
 */

/** ISO-ish enough to slice: "2026-10-26 08:15:00" or the same with a T. */
const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/**
 * One section's meetings, de-duplicated, with how many people each was returned for.
 *
 * The service answers one row per (student, meeting): a lecture of 106 with 13 meetings
 * is 1,378 rows for that CRN alone, and a term is 43,463 rows collapsing to 2,027
 * meetings. Collapsing here rather than in the page is what keeps a whole term ten times
 * under MAX_ROWS instead of silently truncated by it — and the head counts exist only at
 * this moment, because after the collapse there is nothing left to count.
 */
export function collapse(rows) {
  const meetings = new Map();
  let malformed = 0;
  let section = null;
  for (const row of rows) {
    const start = String(row.EVEN_START || '');
    const end = String(row.EVENT_END || '');
    if (!STAMP.test(start) || !STAMP.test(end)) {
      // Counted and reported, never dropped in silence: an unparseable time becomes "no
      // clash" at compare time, which is invisible. It has to be caught at ingest.
      malformed += 1;
      continue;
    }
    const meetsOn = start.slice(0, 10);
    const startsAt = start.slice(11, 16);
    const endsAt = end.slice(11, 16);
    const key = meetsOn + ' ' + startsAt + ' ' + endsAt;
    const held = meetings.get(key);
    if (held) {
      held.seen += 1;
    } else {
      meetings.set(key, {
        meetsOn,
        startsAt,
        endsAt,
        /* "Room: 5.111" is how the portal writes it; the room is 5.111. Empty is allowed:
           a class with no room booked is the thing we are looking for. */
        room: String(row.ROOM_CODE || '').replace(/^\s*Room:\s*/i, '').trim(),
        seen: 1,
      });
    }
    if (!section) {
      section = {
        courseCode: String(row.COURSE_CODE || '').trim(),
        title: String(row.COURSE_TITLE || '').trim(),
        teacherName: String(row.TEACHER_NAME || '').trim(),
      };
    }
  }
  return { meetings: [...meetings.values()], malformed, section };
}

/*
 * There is no head count here, and there cannot be.
 *
 * One was designed and built: the service answers one row per (student, meeting), so
 * counting the rows that fall into each meeting key gives how many people are in it. That
 * is true of `p_UCategory=Student`. It is NOT true of `CRN`, which is the only category
 * this extension will ask for — that one answers a section's own schedule, one row per
 * meeting, so the count is always exactly 1.
 *
 * Measured rather than assumed: 110 sections, every one of them "1", against a portal
 * course list that says 54 registered in the largest. A number that is always 1 is worse
 * than no number, because `head_count` is NULL-able precisely so that consumers can skip
 * what is not known, and a confident 1 defeats that.
 *
 * So sections carry no head count, `facility_sections.head_count` stays NULL, and anything
 * that wants enrolment reads `portal_courses.registered`, which is the registrar's own
 * count and is right.
 */

