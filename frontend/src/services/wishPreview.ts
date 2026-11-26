/**
 * The coordinators' preview of the teacher's page (25 Nov 2026): the request as a teacher sees
 * it, with every step a teacher can have, and nothing saved anywhere.
 *
 * The sample teacher is a full-timer who leads a course, so the page has all three steps: hour
 * reductions, the course schedule, the preferences and constraints. What a teacher's page reads
 * from the semester is the real thing — the collection's days, hours, deadline and message, the
 * teaching weeks with their breaks and holidays, the hour reduction rules — read with the
 * coordinator's own sign-in. What the sample teacher answers lives in this page only: Save and
 * Submit go nowhere, and Start again (in place of Sign out) puts it back as it was.
 */

import { fetchCoursePlans, type CoursePlan, type TeachingWeek } from "@/services/coursePlans";
import { fetchReductionRules, hoursOf, type ReductionInput, type ReductionItem, type ReductionRules, type ReductionSheet } from "@/services/hourReductions";
import { fetchPlan } from "@/services/semesterPlans";
import { answerLines, fetchWishSemester, type WishCalendar, type WishCollection, type Wishes, type WishesInput } from "@/services/teacherWishes";
import type { CourseLayoutInput, Invitation, InviteeForm, InviteeSource } from "@/services/wishInvite";

export const SAMPLE_TEACHER = "Sample Teacher";
export const SAMPLE_EMAIL = "sample.teacher@example.com";
const SAMPLE_COURSE = "SAMPLE-101";
const HEAD = "the Head of Department";

/** "2026-2027", the academic year a portal term is in: 262710 and 262720 are both. */
export function yearOfTerm(term: string): string {
  return /^\d{6}$/.test(term) ? `20${term.slice(0, 2)}-20${term.slice(2, 4)}` : "";
}

/** A semester not yet opened for answers is previewed with the settings a new one starts from. */
function collectionOr(collection: WishCollection | null, term: string): WishCollection {
  return (
    collection ?? {
      termCode: term,
      deadline: "",
      message: "",
      days: [1, 2, 3, 4, 5],
      firstHour: 8,
      lastHour: 19,
      mustQuota: 2,
      cantCap: 12,
      openedAt: "",
      openedBy: "",
    }
  );
}

/**
 * The sample full-timer's year: nothing of their own declared yet, and one department reduction
 * already set by the Head of Department, so the step's second part shows what it is for.
 */
export function sampleReductions(found: ReductionRules, year: string): ReductionSheet {
  const department = found.rules.find((rule) => rule.group === "department" && rule.unit === "choice" && rule.options?.length)
    ?? found.rules.find((rule) => rule.group === "department" && rule.unit === "yes");
  const items: ReductionItem[] = found.rules.map((rule) => {
    const option = rule === department && rule.unit === "choice" ? rule.options?.[0] : undefined;
    const set = rule === department;
    const amount = set ? 1 : 0;
    const detail = option?.key ?? "";
    return {
      ...rule,
      amount,
      detail,
      hours: set ? hoursOf(rule, amount, detail) : 0,
      state: set ? "set" : "",
      updatedAt: "",
      updatedBy: set ? HEAD : "",
      validatedAt: "",
      ...(rule.kind === "irg" ? { available: rule.cap ?? 0 } : {}),
    };
  });
  return totalled({ year, service: found.service, items, total: 0, owed: 0, declaredAt: "", declaredBy: "", note: "" });
}

function totalled(sheet: ReductionSheet): ReductionSheet {
  const total = sheet.items.reduce((sum, item) => sum + item.hours, 0);
  return { ...sheet, total, owed: Math.max(0, sheet.service - total) };
}

/** A course the sample teacher leads: lectures, tutorials and practicals, their hours and session lengths set. */
export function sampleCourse(): CoursePlan {
  return {
    courseCode: SAMPLE_COURSE,
    title: "Sample course",
    coefficient: "",
    active: true,
    components: {
      CM: { hours: 24, length: 1.5, source: "asks" },
      TD: { hours: 18, length: 1.5, source: "asks" },
      // Practicals too, so the order of a week's kinds can be tried (26 Nov 2026).
      TP: { hours: 12, length: 3, source: "asks" },
    },
    hoursUpdatedAt: "",
    hoursUpdatedBy: "",
    leadId: "sample",
    leadName: SAMPLE_TEACHER,
    leadSetAt: "",
    leadSetBy: "",
    weeks: {},
    lengths: {},
    exams: {},
    cmFirst: false,
    tdBeforeTp: false,
    note: "",
    paceReason: "",
    answeredAt: "",
    answeredBy: "",
    answerSource: "",
  };
}

/** An answer as the server would keep it, from what the form sends. */
export function answerOf(input: WishesInput, before: Wishes | null, now: string): Wishes {
  const comments = input.comments ?? {};
  const lines = answerLines(input.blocks, input.limits, input.limitKinds).map((line) => ({
    ...line,
    level: line.level ?? ("would" as const),
    comment: input.blocks.find((block) => block.id === line.key)?.comment ?? comments[line.key] ?? "",
  }));
  return {
    status: input.submit ? "submitted" : before?.status === "submitted" ? "submitted" : "draft",
    blocks: input.blocks,
    limits: input.limits,
    limitKinds: input.limitKinds,
    comments,
    needs: input.needs,
    note: input.note,
    lines,
    overCapReason: input.overCapReason,
    source: "invitation",
    submittedAt: input.submit ? now : (before?.submittedAt ?? ""),
    updatedAt: now,
    updatedBy: SAMPLE_EMAIL,
  };
}

/** The semester as the sample teacher's page reads it. */
export type PreviewSemester = {
  term: string;
  name: string;
  collection: WishCollection;
  calendar: WishCalendar | null;
  weeks: TeachingWeek[];
  rules: ReductionRules | null;
};

/** What the page reads of the semester, with the coordinator's sign-in; the rules may be refused, and the step then left out. */
export async function readPreviewSemester(term: string): Promise<PreviewSemester> {
  const [semester, plans, rules, plan] = await Promise.all([
    fetchWishSemester(term),
    fetchCoursePlans(term).catch(() => null),
    fetchReductionRules().catch(() => null),
    fetchPlan(term).catch(() => null),
  ]);
  return {
    term,
    name: plan?.name ?? "",
    collection: collectionOr(semester.collection, term),
    calendar: semester.calendar ?? null,
    weeks: plans?.weeks ?? [],
    rules,
  };
}

/** A sample teacher's page, kept in the browser: every save answers as the server would, and keeps nothing. */
export function previewSource(semester: PreviewSemester, now: () => string = () => new Date().toISOString()): InviteeSource {
  const year = yearOfTerm(semester.term);
  const fresh = (): InviteeForm => ({
    semesterName: semester.name,
    teacherName: SAMPLE_TEACHER,
    email: SAMPLE_EMAIL,
    collection: semester.collection,
    calendar: semester.calendar,
    wishes: null,
    // Open, whatever the date: the preview is for seeing the form, deadline passed or not.
    window: { open: true, deadline: semester.collection.deadline, reopenedUntil: "" },
    previous: null,
    reductions: semester.rules && year ? sampleReductions(semester.rules, year) : null,
    coursePlans: { termCode: semester.term, weeks: semester.weeks, courses: [sampleCourse()] },
  });
  let form = fresh();
  const kept = (next: InviteeForm) => {
    form = next;
    return Promise.resolve(structuredClone(form));
  };

  const invitation = (): Invitation => ({
    semesterName: semester.name,
    teacherName: SAMPLE_TEACHER,
    email: SAMPLE_EMAIL,
    deadline: semester.collection.deadline,
    message: semester.collection.message,
    signedIn: true,
  });

  return {
    invitation: () => Promise.resolve(invitation()),
    form: () => Promise.resolve(structuredClone(form)),
    saveAnswer: (input) => kept({ ...form, wishes: answerOf(input, form.wishes, now()) }),
    saveReductions: (items: Record<string, ReductionInput>, note: string) => {
      const sheet = form.reductions;
      if (!sheet) return Promise.resolve(structuredClone(form));
      const at = now();
      const changed = sheet.items.map((item) => {
        const given = items[item.kind];
        if (!given || item.group !== "safir") return item;
        const detail = Array.isArray(given.detail) ? given.detail.join(",") : (given.detail ?? item.detail);
        if (given.amount === null) return { ...item, amount: 0, detail: "", hours: 0, state: "" as const, updatedAt: at, updatedBy: SAMPLE_EMAIL };
        const amount = given.amount ?? item.amount;
        return { ...item, amount, detail, hours: hoursOf(item, amount, detail), state: "declared" as const, updatedAt: at, updatedBy: SAMPLE_EMAIL };
      });
      return kept({ ...form, reductions: totalled({ ...sheet, items: changed, declaredAt: at, declaredBy: SAMPLE_EMAIL, note }) });
    },
    saveCoursePlans: (courses: CourseLayoutInput[]) => {
      const plans = form.coursePlans;
      if (!plans) return Promise.resolve(structuredClone(form));
      const at = now();
      const laid = plans.courses.map((course) => {
        const given = courses.find((each) => each.courseCode === course.courseCode);
        if (!given) return course;
        return {
          ...course,
          weeks: given.weeks,
          lengths: given.lengths,
          exams: given.exams ?? course.exams ?? {},
          cmFirst: given.cmFirst ?? course.cmFirst ?? false,
          tdBeforeTp: given.tdBeforeTp ?? course.tdBeforeTp ?? false,
          note: given.note,
          paceReason: given.paceReason ?? "",
          answeredAt: at,
          answeredBy: SAMPLE_EMAIL,
          answerSource: "lead" as const,
        };
      });
      return kept({ ...form, coursePlans: { ...plans, courses: laid } });
    },
    signOut: () => {
      form = fresh();
      return Promise.resolve();
    },
  };
}
