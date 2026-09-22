/**
 * How to reach one record's thread of comments.
 *
 * A thread is the same thing wherever it hangs — lines, signed and dated, one's own to
 * take back — so the component that draws one takes the three calls rather than growing a
 * second copy of itself for every kind of record.
 *
 * The calls are wrapped rather than handed over, so the binding is read when the call is
 * made. Handing the function itself over captures it at module load, which is invisible
 * in the application and silently breaks any test that stands in for it.
 */

import {
  deleteComment,
  fetchComments,
  postComment,
} from "@/services/studentComments";
import {
  deleteTeacherComment,
  listTeacherComments,
  postTeacherComment,
} from "@/services/teachers";

/** What a thread shows of one line. Which record it hangs from is not one of them. */
export type ThreadLine = {
  id: string;
  body: string;
  authorEmail: string;
  authorName: string;
  createdAt: string;
};

export type Thread = {
  list: (subjectId: string) => Promise<ThreadLine[]>;
  post: (subjectId: string, body: string) => Promise<unknown>;
  remove: (commentId: string) => Promise<unknown>;
  /** What the row's mark is read under, so the right count is refreshed after a line. */
  countsKey: string;
  /** What the record is called, so the box says who will read what is typed into it. */
  noun: string;
};

export const STUDENT_THREAD: Thread = {
  list: (studentId) => fetchComments(studentId),
  post: (studentId, body) => postComment(studentId, body),
  remove: (commentId) => deleteComment(commentId),
  countsKey: "comment-summary",
  noun: "student",
};

export const TEACHER_THREAD: Thread = {
  list: (teacherId) => listTeacherComments(teacherId),
  post: (teacherId, body) => postTeacherComment(teacherId, body),
  remove: (commentId) => deleteTeacherComment(commentId),
  countsKey: "teacher-comment-counts",
  noun: "teacher",
};
