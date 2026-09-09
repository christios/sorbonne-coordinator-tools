/**
 * One sweep of the registrar's timetable: what to ask, asking it, and writing it down.
 *
 * Three legs and this is the only place they meet. The list of CRNs comes from our own
 * server — from the registrations we already hold, which is the only list that carries the
 * electives — the asking is the extension's, because only a coordinator's own portal
 * session may ask, and the answer goes back to our server, which is never told a name.
 *
 * Slow by construction. The extension asks about one section at a time, two at a time, and
 * a term is a hundred and sixty sections: minutes, not seconds. Pushed harder the portal
 * answers an empty list for about one call in seven, and an empty list is exactly what a
 * section with nothing booked looks like — so a sweep that hurried would report a term's
 * teaching as cancelled.
 */

import { fetchTimetableTargets, recordFacilityPull, type FacilityPullReport } from "@/services/portalLists";
import { pullTimetable, type PullProgress } from "@/services/scenRosters";

export type FacilitySweep = FacilityPullReport & {
  /** Rows the extension could not read a time from. Never silently dropped. */
  malformed: number;
  warning: string | null;
  /** How many of the asked sections belong to other departments. */
  theirs: number;
};

/**
 * @param theirsToo whether to ask about other departments' sections as well as our own.
 *
 * Ours alone is a complete answer to "is our own timetable self-consistent" and nothing
 * more. The collisions nobody has ever been able to see are the ones between our teaching
 * and the language hour or the option a student takes elsewhere, and those need the other
 * department's CRNs — which is a question about their rooms, so it is asked deliberately
 * rather than by default.
 */
export async function sweepFacilityTimetable(
  termCode: string,
  { theirsToo = true }: { theirsToo?: boolean } = {},
  onProgress?: (progress: PullProgress) => void,
): Promise<FacilitySweep> {
  const targets = await fetchTimetableTargets(termCode);
  const crns = [...new Set(theirsToo ? [...targets.ours, ...targets.registered] : targets.ours)];
  if (!crns.length) {
    // Nothing registered for this term yet. Writing an empty sweep would be worse than
    // doing nothing: a complete sweep that asked about nothing still counts as a pull.
    return { asked: 0, answered: 0, silent: 0, failed: 0, complete: false, malformed: 0, warning: "nothing_to_ask", theirs: 0 };
  }

  const pull = await pullTimetable(termCode, crns, onProgress);
  /*
   * Which of the answers are OUR sections, marked here rather than in the extension.
   *
   * The extension asks the registrar about a list of CRNs and has no idea which of them
   * the department teaches — that is the register's business, and teaching it to a browser
   * extension would put a second copy of the boundary somewhere nobody reviews. So the
   * page, which asked for both lists and knows which is which, says so on the way back.
   *
   * It is not decoration: the store keeps a head count only for a section that is ours,
   * deliberately, because another department's enrolment is a fact about them. Without
   * this every head count was dropped — 145 sections, none with a count.
   */
  const mine = new Set(targets.ours);
  const sections = pull.sections.map((section) => ({
    ...section,
    ours: mine.has(section.crn),
    // The rooms a section uses, from the meetings that name them. Display only; the
    // meetings keep their own, which is what a room change is actually seen in.
    rooms: [...new Set(section.meetings.map((meeting) => meeting.room).filter(Boolean))],
  }));
  /*
   * The store refuses a sweep it cannot account for, so `asked` travels exactly as the
   * extension reported it rather than as the list we sent. They are the same list, and
   * saying so twice is how they would come to differ.
   */
  const report = await recordFacilityPull({
    termCode: pull.termCode,
    asked: pull.asked,
    sections,
    silent: pull.silent,
    failed: pull.failed,
    complete: pull.complete,
  });
  return { ...report, malformed: pull.malformed, warning: pull.warning, theirs: targets.registered.length };
}

/**
 * What a finished sweep has to warn about — and "" when the answer is simply the answer.
 *
 * How much of a semester the registrar has booked is not a warning. Ten sections with no
 * room is what September looks like, and a sync that ends in an amber triangle every
 * single time teaches a coordinator to ignore triangles. That count is a qualification on
 * the clashes, so it belongs on Groups & CRNs beside them — see `describeClashCoverage` —
 * and this is left with what actually went wrong: sections the portal refused, rows whose
 * times could not be read, and a sweep that stopped early, which retires nothing.
 */
export function describeSweep(sweep: FacilitySweep): string {
  // Nothing registered yet is not a fault of the sweep, and `complete` is false only
  // because it never ran.
  if (sweep.warning === "nothing_to_ask") return "";
  const wrong: string[] = [];
  if (sweep.failed) wrong.push(`${sweep.failed} the portal would not answer for`);
  if (sweep.malformed) wrong.push(`${sweep.malformed} rows whose times could not be read`);
  if (!sweep.complete) wrong.push("the sweep did not finish, so nothing was retired by it");
  if (!wrong.length) return "";
  return `${sweep.answered} of ${sweep.asked} sections timetabled · ${wrong.join(" · ")}.`;
}
