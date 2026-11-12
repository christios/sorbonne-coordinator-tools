import { useQuery } from "@tanstack/react-query";

import { NO_COURSE_PROGRAMS, fetchCoursePrograms, type CoursePrograms } from "@/services/coursePrograms";

export const COURSE_PROGRAMS_QUERY = ["course-programs"];

/**
 * The department's programmes and which courses count as each, for a page that narrows
 * its courses to one. Nothing while it loads, or if it cannot be read: every course is then
 * in no programme, and the page's Program filter simply has nothing to offer.
 */
export function useCoursePrograms(): CoursePrograms {
  const held = useQuery({ queryKey: COURSE_PROGRAMS_QUERY, queryFn: fetchCoursePrograms, retry: false, staleTime: 60_000 });
  return held.data ?? NO_COURSE_PROGRAMS;
}
