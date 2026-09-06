/**
 * What a course asks of the timetable, and how a section's silence is answered.
 *
 * Six tutorial groups of Pre-calculus want the same thirty-six hours over the same weeks
 * in the same sort of room. That was typed into six sections, and the seventh group added
 * in October was typed into by whoever remembered. The course says it once instead, per
 * set — because a lecture is twenty-four hours and a tutorial thirty-six — and per cohort
 * and semester, because next year's answer is next year's.
 *
 * Nothing is copied at rest. A section that has been told nothing goes on saying so, and
 * the two lines stay separate claims about the world: what the course wants, and what
 * anybody has said about this particular group. `filled` is where they meet, and it is
 * only ever asked for on the way into the workbook the timetabler receives — so changing
 * what the course asks reaches every section that never had an answer of its own, without
 * touching one that did.
 */

import type { Request, Section } from "@/services/studentDatabase";

/** True when nobody has asked this course for anything yet. */
export function isSilent(request: Request): boolean {
  return (
    !request.hours &&
    !request.anticipated &&
    !request.teacherId &&
    !request.sessionsPerWeek &&
    !request.duration &&
    !request.weeks &&
    !request.roomPref &&
    !request.dayPref &&
    !request.timePref &&
    !request.constraints &&
    !request.comments
  );
}

/** "weeks 2–14 · 2 sessions · 1.5 h each" — how the hours are spread, in one line. */
export function spread(request: Request): string {
  return [request.weeks && `weeks ${request.weeks}`, request.sessionsPerWeek, request.duration && `${request.duration} h each`]
    .filter(Boolean)
    .join(" · ");
}

/** "Amphitheatre · avoid Fridays · mornings" — what it asks of the room and the week. */
export function preferences(request: Request): string {
  return [request.roomPref, request.dayPref, request.timePref, request.constraints, request.comments]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The section as the workbook should carry it: its own answers, and the course's where it
 * has none.
 *
 * Field by field, not all-or-nothing. A section that states its own teacher and nothing
 * else should still be written out with the course's hours; the alternative — the course
 * only counting for a section that says nothing at all — would mean naming a teacher
 * silently dropped the hours, which nobody would predict.
 *
 * Blank is the only thing that inherits. A zero anticipated is a blank, because the field
 * has no way to say "none": it is a count nobody has given.
 */
export function filled(section: Section, course: Request): Section {
  return {
    ...section,
    // The course only names a teacher for a section that names nobody at all. A row
    // carrying a name the registrar wrote — unconfirmed, but a name — is not silence.
    teacherId: section.teacherId || (section.teacher ? "" : course.teacherId),
    hours: section.hours || course.hours,
    sessionsPerWeek: section.sessionsPerWeek || course.sessionsPerWeek,
    duration: section.duration || course.duration,
    weeks: section.weeks || course.weeks,
    anticipated: section.anticipated || course.anticipated,
    roomPref: section.roomPref || course.roomPref,
    dayPref: section.dayPref || course.dayPref,
    timePref: section.timePref || course.timePref,
    constraints: section.constraints || course.constraints,
    comments: section.comments || course.comments,
  };
}
