import { API_BASE_URL, apiFetch } from "@/services/http";

/** One entry per course, not per section: a syllabus is the course's document. */
export type CatalogueCourse = {
  courseCode: string;
  courseTitle: string;
  credit: string;
  level: string;
  department: string;
  college: string;
  contactHours: string;
  terms: string[];
  crns: string[];
  /** Who teaches its sections, when Students and Timetables knows. */
  teachers: string[];
};

export async function listCoursesByCode(query = ""): Promise<CatalogueCourse[]> {
  const suffix = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teachers/courses/by-code${suffix}`);
  if (!response.ok) throw new Error("Could not load the course list.");
  const body = (await response.json()) as { items?: CatalogueCourse[] };
  return body.items ?? [];
}

/** How a course reads in a picker: the code is what people search by. */
export function courseLabel(course: CatalogueCourse) {
  return `${course.courseCode} — ${course.courseTitle}`;
}
