/**
 * What would go wrong if a class sat at a time: the clashes it would make and the wishes it
 * would break, before it is placed there.
 *
 * Asked while a class is dragged — the box that shows where it would land turns red or amber
 * — and while its day and hours are chosen in its dialog, which lists the problems first.
 * The same rules as the plan's own (`clashesOf`, `checkWishes`), run on the few classes that
 * matter: those on the same day, and the teacher's own in the weeks asked about.
 */

import { clashesOf, sectionLabel, type Plan, type PlanClass, type PlanSection } from "@/services/semesterPlans";
import { checkWishes, type WishLevel, type WishTeacher } from "@/services/teacherWishes";
import { parseIsoDate, toIsoDate, weekStartOf } from "@/services/weekSchedule";

export type Candidate = {
  sectionId: string;
  /** 1 is Monday. */
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string;
  /** The teaching weeks it would meet in. */
  weeks: number[];
  /** The series it is a new time for, whose own classes it would replace: nothing to clash with. */
  replacing?: { seriesId: string; weeks?: number[] };
};

export type Problem = {
  kind: "clash" | "wish";
  /** A clash or a period is always a Must. */
  level: WishLevel;
  /** "Same teacher as MATH-114 TD 2 (Tue 14:00–15:30)", "Must · Bilal Maaz: Can't teach Tue 14:00–18:00". */
  said: string;
};

export type Judgement = {
  problems: Problem[];
  /** The worst of them: red for a clash or a Must, amber for a Would like, null for none. */
  worst: "must" | "would" | null;
};

const CLASH_WORDS = { teacher: "Same teacher as", room: "Same room as", students: "May share students with" } as const;

/** The date a weekday of a teaching week falls on. */
function dateOf(plan: Pick<Plan, "weekOne" | "without">, week: number, weekday: number): string {
  const day = parseIsoDate(toIsoDate(weekStartOf(week, { weekOne: plan.weekOne, without: plan.without })));
  day.setDate(day.getDate() + weekday - 1);
  return toIsoDate(day);
}

export function judgeSlot(plan: Plan, teachers: WishTeacher[] | undefined, candidate: Candidate): Judgement {
  const sections = new Map(plan.sections.map((each) => [each.id, each]));
  const section: PlanSection | undefined = sections.get(candidate.sectionId);
  const replaced = (entry: PlanClass) =>
    Boolean(
      candidate.replacing &&
        entry.seriesId === candidate.replacing.seriesId &&
        (!candidate.replacing.weeks || candidate.replacing.weeks.includes(entry.week)),
    );
  const ghosts: PlanClass[] = candidate.weeks.map((week) => ({
    seriesId: candidate.replacing?.seriesId ?? "ghost",
    sectionId: candidate.sectionId,
    week,
    meetsOn: dateOf(plan, week, candidate.weekday),
    weekday: candidate.weekday,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    room: candidate.room,
    teacherName: section?.teacherName ?? "",
    moved: false,
  }));
  const dates = new Set(ghosts.map((ghost) => ghost.meetsOn));
  const problems: Problem[] = [];
  const add = (problem: Problem) => {
    if (!problems.some((each) => each.said === problem.said)) problems.push(problem);
  };

  // Clashes: the plan's own rule, on the classes of the days it would meet on.
  if (candidate.startsAt < candidate.endsAt) {
    const sameDays = plan.classes.filter((entry) => dates.has(entry.meetsOn) && !replaced(entry));
    const found = clashesOf({ ...plan, classes: [...sameDays, ...ghosts] });
    for (const ghost of ghosts) {
      for (const clash of found.get(ghost) ?? []) {
        if (ghosts.includes(clash.with)) continue;
        const other = sections.get(clash.with.sectionId);
        add({
          kind: "clash",
          level: "must",
          said: `${CLASH_WORDS[clash.kind]} ${sectionLabel(other)} (${clash.with.startsAt}–${clash.with.endsAt})`,
        });
      }
    }
  }

  // Wishes: the teacher's own classes in those weeks, with this one where it would be; and the periods.
  const weeks = new Set(candidate.weeks);
  const theirs = section?.teacherId
    ? plan.classes.filter(
        (entry) =>
          weeks.has(entry.week) && !replaced(entry) && sections.get(entry.sectionId)?.teacherId === section.teacherId,
      )
    : [];
  const check = checkWishes({ sections: plan.sections, classes: [...theirs, ...ghosts], periods: plan.periods }, teachers ?? []);
  for (const breach of check.breaches) {
    if (!breach.classes.some((entry) => ghosts.includes(entry))) continue;
    add({
      kind: "wish",
      level: breach.level,
      said:
        breach.about === "period"
          ? `Everybody · ${breach.perClass?.get(ghosts.find((ghost) => breach.classes.includes(ghost)) as PlanClass) ?? breach.wish}`
          : `${breach.level === "must" ? "Constraint" : "Preference"} · ${breach.teacherName}: ${breach.wish.replace(/^(Constraint|Preference) · /, "")}${
              breach.comment ? ` — “${breach.comment}”` : ""
            }`,
    });
  }

  problems.sort((left, right) => Number(left.level !== "must") - Number(right.level !== "must"));
  const worst = problems.some((each) => each.level === "must") ? "must" : problems.length ? "would" : null;
  return { problems, worst };
}
