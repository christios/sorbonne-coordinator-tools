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

/**
 * How many students the registrar shows in a section, when that is a single number.
 *
 * Per meeting rather than per section, and then reconciled: a meeting key exists only
 * because a row produced it, so there is never a division and never a zero to divide by.
 * Meetings that disagree — somebody added mid-term — give no single number at all rather
 * than an average nobody could act on. Null means "not a single number", never none.
 */
export function headCount(meetings) {
  const counts = [...new Set(meetings.map(meeting => meeting.seen))];
  if (counts.length === 0) return { headCount: null, headCountLow: null, headCountHigh: null };
  if (counts.length === 1) return { headCount: counts[0], headCountLow: null, headCountHigh: null };
  return { headCount: null, headCountLow: Math.min(...counts), headCountHigh: Math.max(...counts) };
}

