import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, HelpCircle, Pencil, Wand2 } from "lucide-react";
import { useState } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { anticipatedOf, cardSubRows, type Card, type CardSet, type SectionRow } from "@/services/courseCards";
import { MUTUALIZED_WORDS, type ActiveTeacher, type TermCrns } from "@/services/portalLists";
import type { CrnVerdict, GroupClash } from "@/services/publication";
import { toneOf, verdictFor, type VerdictTone } from "@/services/publicationView";
import {
  type Cohort,
  EMPTY_PART,
  parentsOf,
  type SectionPart,
  setGroupCrn,
  shortProgram,
  updateGroup,
  updateMajor,
  updateSection,
} from "@/services/studentDatabase";

const KIND_WORD = { shared: "own groups", nested: "nested" } as const;

/**
 * One course, and under it every section anybody teaches of it.
 *
 * Collapsed, it is one line: the code, the title, where and when, who teaches it, and
 * what is missing. Open, it is the timetabler's rows for this course, set by set — the
 * group, its CRN, the teacher, the hours and sessions, what to expect — read cleanly,
 * with a dialog to change a row. The course's own facts (title, UE, parent CRN) are the
 * active course's and are not edited here.
 */
export function CourseCard({
  card,
  open,
  onToggle,
  cohort,
  teachers,
  portal,
  validation,
  unassigned,
  clashes,
  onChanged,
  onFilled,
}: {
  card: Card;
  open: boolean;
  onToggle: () => void;
  cohort: Cohort | null;
  teachers: ActiveTeacher[];
  /** The portal's CRNs for the card's semester, or null when it is not linked. */
  portal: TermCrns | null;
  validation: Record<string, CrnVerdict>;
  /** Scope code -> students in no group for it, from the publication report. */
  unassigned: Record<string, string[]>;
  clashes: GroupClash[] | null;
  onChanged: () => void;
  onFilled: (report: FillReport) => void;
}) {
  const [filling, setFilling] = useState<CardSet | null>(null);
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.fullName ?? "";
  const rows = card.sets.flatMap((set) => set.rows);
  const named = [...new Set(rows.map((row) => (row.section?.teacherId ? teacherName(row.section.teacherId) : row.section?.teacher ?? "")).filter(Boolean))];
  const missing = rows.filter((row) => !row.section?.crn && !row.section?.retired).length;
  const retired = rows.filter((row) => row.section?.retired).length;
  // A course taught only in sets the whole department shares belongs to no one cohort.
  const shared = card.sets.length > 0 && card.sets.every((set) => set.scope.openToAll);
  const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";

  return (
    <article className={`rounded-lg border bg-white ${open ? "border-[#b7c6d8] shadow-sm" : "border-[#d9dee7]"}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${card.code}`}
          onClick={onToggle}
          className="inline-flex min-w-0 items-center gap-2 text-left"
        >
          {open ? <ChevronDown size={16} className="shrink-0 text-[#98a2b3]" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />}
          <span className="font-semibold tabular-nums text-[#171717]">{card.code}</span>
          <span className="truncate text-[#344054]">{card.name || <span className="text-[#98a2b3]">untitled</span>}</span>
        </button>
        {/*
          * Whose card this is. A course taught only in sets open to every cohort is the
          * department's — the languages — and naming the cohort whose row happens to hold
          * the set said something untrue.
          */}
        <span className={`${chip} ${shared ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#eef1f5] text-[#344054]"}`}>
          {shared ? "Across cohorts" : card.cohortName} · {card.termName || "no semester"}
        </span>
        {!card.active ? (
          <span className={`${chip} bg-[#fdf9ee] text-[#8a6116]`} title="Choose it on the Courses page so it carries a UE and a parent CRN">
            Not on the active list
          </span>
        ) : null}
        {/*
          * Whether both degrees sit in it together. Said only once somebody has said it:
          * a course nobody has answered for is not the same as one taught separately.
          */}
        {card.active?.mutualized ? (
          <span
            className={`${chip} ${card.active.mutualized === "yes" ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"}`}
            title={
              card.active.mutualized === "yes"
                ? "Taught to the mathematicians and the physicists at once"
                : "Taught to one degree alone"
            }
          >
            {MUTUALIZED_WORDS[card.active.mutualized]}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-[#667085]">
          <span>
            {rows.length} section{rows.length === 1 ? "" : "s"} in {card.sets.map((set) => set.scope.code).join(", ")}
          </span>
          {named.length ? <span className="text-[#344054]">{named.join(", ")}</span> : <span className="text-[#98a2b3]">no teacher yet</span>}
          {missing ? <span className={`${chip} bg-[#fdf3f3] text-[#a6292f]`}>{missing} without CRN</span> : null}
          {retired ? <span className={`${chip} bg-[#f2f4f7] text-[#98a2b3]`}>{retired} retired</span> : null}
        </span>
      </header>

      {open ? (
        <div className="divide-y divide-[#eef1f5] border-t border-[#eef1f5]">
          {card.sets.map((set) => {
            const left = unassigned[set.scope.code]?.length ?? 0;
            return (
              <section key={set.scope.id} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-[#1f4e79]">{set.scope.code}</span>
                  {/* Said once: on a card that is wholly shared the header says it already. */}
                  {set.scope.openToAll && !shared ? (
                    <span className="rounded-full bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold text-[#344054]" title="Any student of any cohort may be in this set">
                      open to every cohort
                    </span>
                  ) : null}
                  <span className="text-[#667085]">
                    {set.scope.name || "group set"} · {KIND_WORD[set.scope.kind] ?? set.scope.kind} · {set.scope.groups.length} group
                    {set.scope.groups.length === 1 ? "" : "s"}
                    {set.course.component ? ` · ${set.course.component}` : ""}
                  </span>
                  {left ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf9ee] px-2 py-0.5 text-xs font-semibold text-[#8a6116]">
                      <AlertTriangle size={11} aria-hidden="true" /> {left} in no group
                    </span>
                  ) : null}
                  {cohort ? (
                    <button
                      type="button"
                      onClick={() => setFilling(set)}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                    >
                      <Wand2 size={13} aria-hidden="true" /> Fill {set.scope.code}
                    </button>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[#98a2b3]">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Group</th>
                        <th className="py-1 pr-3 font-semibold">CRN</th>
                        <th className="py-1 pr-3 font-semibold">Teacher</th>
                        <th className="py-1 pr-3 text-right font-semibold">Hours</th>
                        <th className="py-1 pr-3 font-semibold">Sessions / week</th>
                        <th className="py-1 pr-3 text-right font-semibold">Duration</th>
                        <th className="py-1 pr-3 font-semibold">Weeks</th>
                        <th className="py-1 pr-3 text-right font-semibold">Students</th>
                        <th className="py-1 pr-3 font-semibold">Asks of the timetable</th>
                        <th className="py-1 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {set.rows.map((row) => (
                        <SectionLine
                          key={row.group.id}
                          row={row}
                          teacherName={teacherName}
                          portal={portal}
                          verdict={verdictFor(validation, row.group.id, row.course.code)}
                          onEdit={() => setEditing(row)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {filling && cohort ? (
        <FillBlock
          open
          cohort={cohort}
          scope={filling.scope}
          clashes={clashes}
          onClose={() => setFilling(null)}
          onFilled={(report) => {
            setFilling(null);
            onFilled(report);
          }}
        />
      ) : null}

      {editing ? (
        <SectionDialog
          card={card}
          row={editing}
          teachers={teachers}
          portal={portal}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </article>
  );
}

/** What a section asks of the timetable, in one short line. */
function asks(section: SectionPart): string {
  return [
    section.roomPref ? `room ${section.roomPref}` : "",
    section.dayPref ? `day ${section.dayPref}` : "",
    section.timePref ? `time ${section.timePref}` : "",
    section.constraints,
    section.comments,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One section, read: every fact on its row, and a pencil to change it. */
function SectionLine({
  row,
  teacherName,
  portal,
  verdict,
  onEdit,
}: {
  row: SectionRow;
  teacherName: (id: string) => string;
  portal: TermCrns | null;
  verdict?: CrnVerdict;
  onEdit: () => void;
}) {
  const held = row.section ?? EMPTY_PART;
  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;
  const portalRow = portal && held.crn ? (portal.crns[held.crn] ?? null) : undefined;
  const chosen = held.teacherId ? teacherName(held.teacherId) : "";
  const dim = held.retired ? "text-[#98a2b3]" : "";
  const asked = asks(held);
  /** Grey for what nobody has asked yet; red only for what is ours to fix. */
const TONE: Record<VerdictTone, string> = { settled: "", unasked: "text-[#98a2b3]", fault: "text-[#a6292f]" };

const empty = <span className="text-[#c8d0da]">—</span>;

  return (
    <tr
      className={`cursor-pointer border-t border-[#eef1f5] align-top hover:bg-[#fafbfc] ${dim}`}
      onClick={onEdit}
      title={`Edit ${label}`}
    >
      <td className="py-2 pr-3">
        <span className={`font-semibold ${held.retired ? "" : "text-[#171717]"}`}>{row.group.label}</span>
        {held.retired ? <span className="ml-1.5 rounded-full bg-[#f2f4f7] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#98a2b3]">Retired</span> : null}
        <span className="flex items-center gap-1 text-[11px] text-[#98a2b3]">
          <span>{row.group.capacity ? `${row.group.assigned}/${row.group.capacity}` : `${row.group.assigned} placed`}</span>
          {/* How many the timetabler was told to expect, as a mark on the seats rather than a pill of its own. */}

        </span>
      </td>
      <td className="py-2 pr-3 tabular-nums">
        {held.crn ? (
          <span className="inline-flex items-center gap-1">
            {/*
              * Three verdicts, not two, and only one of them is our fault.
              *
              * `mismatched` is: the CRN is real and belongs to another course, which is a
              * typo in our planning. `unknown` is not — nobody has asked the registrar
              * about that section yet, or it has no room booked — and drawing it in the
              * same red as a typo asks a coordinator to go and fix something they have not
              * done wrong. Twenty-seven sections wear it today, none of them faults.
              */}
            <span className={TONE[toneOf(verdict)]}>{held.crn}</span>
            {verdict ? (
              verdict.status === "matched" ? (
                <Check size={13} className="text-[#2f6b3d]" aria-label="In the timetable" />
              ) : toneOf(verdict) === "unasked" ? (
                <HelpCircle size={13} className="text-[#98a2b3]" aria-label={verdict.detail} />
              ) : (
                <AlertTriangle size={13} className="text-[#a6292f]" aria-label={verdict.detail} />
              )
            ) : null}
          </span>
        ) : held.retired ? (
          empty
        ) : (
          <span className="rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">no CRN</span>
        )}
        {held.crn && portalRow === null ? <span className="block text-[11px] text-[#a6292f]">Not in the portal&apos;s list</span> : null}
      </td>
      <td className="py-2 pr-3">
        {chosen ? (
          <span className="text-[#171717]">{chosen}</span>
        ) : held.teacher ? (
          <span className="text-[#667085]" title="Named on the row, but not chosen from Active teachers yet">
            {held.teacher} <span className="text-[11px] text-[#98a2b3]">not confirmed</span>
          </span>
        ) : (
          empty
        )}
        {portalRow?.teacherName && portalRow.teacherName !== chosen ? (
          <span className="block text-[11px] text-[#98a2b3]" title="The teacher the portal lists for this CRN">
            Portal: {portalRow.teacherName}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{held.hours || empty}</td>
      <td className="py-2 pr-3">{held.sessionsPerWeek || empty}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{held.duration || empty}</td>
      <td className="py-2 pr-3">{held.weeks || empty}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{anticipatedOf(row) || empty}</td>
      <td className="max-w-[18rem] truncate py-2 pr-3 text-xs text-[#667085]" title={asked}>
        {asked || empty}
      </td>
      <td className="py-1.5 text-right">
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

const field = "mt-1 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal";
const fieldLabel = "block text-xs font-semibold text-[#344054]";

/**
 * Everything the timetabler's workbook says about one section, on one form.
 *
 * The CRN is chosen from the portal's list for this course when the semester is linked
 * — a CRN typed by hand is how a digit goes wrong — and the teacher from Active teachers.
 * The rest is what the workbook's columns always were.
 */
export function SectionDialog({
  card,
  row,
  teachers,
  portal,
  onClose,
  onSaved,
}: {
  card: Card;
  row: SectionRow;
  teachers: ActiveTeacher[];
  portal: TermCrns | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const held = row.section ?? EMPTY_PART;
  const [draft, setDraft] = useState<SectionPart>({ ...held });
  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;
  const set = (patch: Partial<SectionPart>) => setDraft((current) => ({ ...current, ...patch }));
  /*
   * Whose cell this is, on a group with sub-rows: everybody's — the mutualized lecture,
   * one CRN under every major — or this sub-row's own, or the sub-row's word that it is
   * not taught the course at all. A group with no sub-rows has no such question.
   */
  type Whose = "everyone" | "own" | "not-taught";
  const [whose, setWhose] = useState<Whose>(
    row.notTaught ? "not-taught" : row.major && held.majorId === row.major.id ? "own" : "everyone",
  );
  const majorId = whose === "everyone" || !row.major ? "" : row.major.id;
  // A group with one sub-row: taught or not, and taught keeps the cell where it already is.
  const alone = (row.group.majors ?? []).length < 2;
  const taughtAs: Whose = row.major && held.majorId === row.major.id && !held.notTaught ? "own" : "everyone";

  /*
   * The seats, set here rather than on Group schema: the schema says what the groups are,
   * and the cards say how big each one is. They are the group's — or its sub-row's — for
   * every course of the set, so a change here shows on every card of the group, and the
   * class's seats are what the timetabler is told to expect.
   */
  const holders = cardSubRows(row);
  const [seats, setSeats] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      holders.length
        ? holders.map((major) => [major.id, String(major.seats || "")])
        : [[row.group.id, String(row.group.capacity || "")]],
    ),
  );
  const resize = async () => {
    if (row.notTaught) return;
    for (const major of holders) {
      const next = Number(seats[major.id] || 0);
      if (next !== major.seats) await updateMajor(major.id, { program: major.program, seats: next });
    }
    const next = Number(seats[row.group.id] || 0);
    if (!holders.length && next !== row.group.capacity) {
      await updateGroup(row.group.id, {
        label: row.group.label,
        capacity: next,
        note: row.group.note,
        parentGroupIds: parentsOf(row.group),
        firstFor: row.group.firstFor ?? "",
        parallelWith: row.group.parallelWith,
      });
    }
  };

  // The portal's CRNs of this course in this semester, the one already held first.
  const crnOptions = portal
    ? Object.entries(portal.crns)
        .filter(([, known]) => known.courseCode.toUpperCase() === card.code.toUpperCase())
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([crn, known]) => ({
          value: crn,
          label: crn,
          searchText: known.teacherName,
          badge: known.status === "in_portal" ? known.teacherName || undefined : "no longer listed",
          badgeTone: "muted" as const,
        }))
    : [];
  if (draft.crn && !crnOptions.some((option) => option.value === draft.crn)) {
    crnOptions.unshift({ value: draft.crn, label: draft.crn, searchText: "", badge: portal ? "not in the portal's list" : undefined, badgeTone: "muted" as const });
  }
  const portalTeacher = portal && draft.crn ? (portal.crns[draft.crn]?.teacherName ?? "") : "";

  /*
   * Hand the rest of the semester to somebody else.
   *
   * MATH-351 is Grace Younes to late October and Sudarshan Shinde after it, and the
   * registrar publishes a CRN for each half. Before this the only ways to hold the second
   * one were a group nobody is in or a line of free text — and the free text is what was
   * there, saying "nobody is registered in 24311 and 24313" about eleven students who are.
   *
   * It writes an empty part rather than asking for its CRN here: the next part opens as a
   * card of its own beside this one, filled in the same way as every other section.
   */
  const split = useMutation({
    mutationFn: async () => {
      const next = (row.parts ?? 1) + 1;
      await updateSection(row.group.id, row.course.id, { ...EMPTY_PART, part: next, majorId });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      await resize();
      if (row.notTaught && row.major && whose !== "not-taught") {
        // Taught again: the sub-row's word is taken back, and the group's own section shows through.
        await setGroupCrn(row.group.id, row.course.id, { crn: "", part: 1, majorId: row.major.id });
      }
      const crn = draft.crn.trim();
      // The part being edited, so a handover's second half is written to its own row
      // rather than over the first professor's.
      const part = held.part || 1;
      // Only the seats changed on a row nobody has started: no empty section is written for it.
      if (!row.section && whose !== "not-taught" && JSON.stringify(draft) === JSON.stringify(held)) return;
      if (whose === "not-taught" && row.major) {
        // The sub-row's word about the course; it has no CRN and no request of its own.
        await setGroupCrn(row.group.id, row.course.id, { crn: "", part, majorId: row.major.id, notTaught: true });
        return;
      }
      // Moved from the shared cell to the sub-row's own, or back: the old one is not
      // touched — a shared lecture stays the other sub-rows' — and the new one is written.
      if (crn !== held.crn || majorId !== held.majorId || held.notTaught) {
        await setGroupCrn(row.group.id, row.course.id, { crn, teacher: held.teacher, part, majorId });
      }
      const details: Partial<SectionPart> = { ...draft, part, majorId };
      delete details.crn;
      delete details.teacher;
      delete details.notTaught;
      await updateSection(row.group.id, row.course.id, details as Omit<SectionPart, "crn" | "teacher" | "notTaught">);
    },
    onSuccess: onSaved,
  });

  return (
    <Modal
      open
      size="wide"
      title={`${card.code} · ${row.scope.code} ${row.group.label}`}
      description={`${card.name || "This course"}${row.course.component ? `, ${row.course.component}` : ""} — the row the timetabler gets for this group.`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-[#344054]">
            <input type="checkbox" aria-label={`Retire ${label}`} checked={draft.retired} onChange={(event) => set({ retired: event.target.checked })} />
            Retired — kept on the workbook, marked, and the fill skips it
          </label>
          <div className="flex items-center gap-3">
            {/* Offered on the last part only, so a three-way split is made one hand-over
                at a time rather than from whichever card happened to be open. */}
            {held.part === (row.parts ?? 1) ? (
              <button
                type="button"
                disabled={split.isPending}
                onClick={() => split.mutate()}
                title="For a course handed from one professor to another partway through the semester"
                className="text-sm font-semibold text-[#1f4e79] disabled:text-[#9ba8b5]"
              >
                {split.isPending ? "Adding…" : "Taught in another part"}
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      {row.major ? (
        /*
         * Whose cell this is, on a group with sub-rows, in words that fit any department: the
         * sub-row is named in the title above, not on every button.
         *
         * With one sub-row, "the whole group" and "this sub-row" are the same people, so the
         * only question left is whether the group is taught the course at all.
         */
        <div className="mb-4">
          <span className={fieldLabel}>{alone ? "Is this group taught the course?" : "This section is for"}</span>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={`Whose cell ${label} is`}>
            {(alone
              ? ([
                  ["taught", "Taught", "The group takes this course."],
                  ["not-taught", "Not taught", "No class and no CRN for this group."],
                ] as const)
              : ([
                  ["everyone", "Whole group", "One section for every sub-row."],
                  ["own", "This sub-row only", "Its own section; the other sub-rows keep theirs."],
                  ["not-taught", "Not taught to this sub-row", "No class and no CRN for it."],
                ] as const)
            ).map(([value, title, hint]) => {
              const chosen = value === "taught" ? whose !== "not-taught" : whose === value;
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                    chosen ? "border-[#1f4e79] bg-[#f2f7fb]" : "border-[#d9dee7] bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="whose-cell"
                    value={value}
                    checked={chosen}
                    onChange={() => setWhose(value === "taught" ? taughtAs : value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-[#344054]">{title}</span>
                    <span className="block text-[11px] text-[#98a2b3]">{hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={`grid gap-4 sm:grid-cols-2 ${whose === "not-taught" ? "pointer-events-none opacity-40" : ""}`}>
        <div>
          <span className={fieldLabel}>CRN</span>
          {portal ? (
            <div className="mt-1">
              <SelectMenu
                label={`CRN for ${label}`}
                value={draft.crn}
                placeholder={crnOptions.length ? "Which CRN…" : "The portal lists no CRN of this course"}
                searchable={crnOptions.length > 8}
                onChange={(crn) => set({ crn })}
                options={[{ value: "", label: "None yet" }, ...crnOptions]}
              />
            </div>
          ) : (
            <input aria-label={`CRN for ${label}`} value={draft.crn} inputMode="numeric" onChange={(event) => set({ crn: event.target.value })} placeholder="23223" className={field} />
          )}
          <span className="mt-1 block text-[11px] text-[#98a2b3]">
            {portal ? "From the portal's list for this semester. Clearing it removes the section." : "This semester is not linked to a portal term, so the CRN is typed. Link it on the Semesters page."}
          </span>
        </div>
        <div>
          <span className={fieldLabel}>Teacher</span>
          <div className="mt-1">
            <SelectMenu
              label={`Teacher for ${label}`}
              value={draft.teacherId}
              placeholder="Not chosen"
              searchable={teachers.length > 8}
              onChange={(teacherId) => set({ teacherId })}
              options={[{ value: "", label: "Not chosen" }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.fullName, searchText: teacher.email }))]}
            />
          </div>
          <span className="mt-1 block text-[11px] text-[#98a2b3]">
            From Active teachers.{portalTeacher ? ` The portal lists ${portalTeacher} for this CRN.` : ""}
            {!draft.teacherId && held.teacher ? ` The row named ${held.teacher} before anyone was chosen.` : ""}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <label className={fieldLabel}>
          Total hours
          <input aria-label={`Hours for ${label}`} value={draft.hours} onChange={(event) => set({ hours: event.target.value })} placeholder="50" className={field} />
        </label>
        <label className={`${fieldLabel} sm:col-span-2`}>
          Weeks and sessions per week
          <input aria-label={`Sessions per week for ${label}`} value={draft.sessionsPerWeek} onChange={(event) => set({ sessionsPerWeek: event.target.value })} placeholder="2 sessions — weeks 2 to 14" className={field} />
        </label>
        <label className={fieldLabel}>
          Duration (hr/session)
          <input aria-label={`Duration for ${label}`} value={draft.duration} onChange={(event) => set({ duration: event.target.value })} placeholder="1.5" className={field} />
        </label>
        <label className={fieldLabel}>
          Weeks
          <input aria-label={`Weeks for ${label}`} value={draft.weeks} onChange={(event) => set({ weeks: event.target.value })} placeholder="2–14" className={field} />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        {row.notTaught ? (
          <span />
        ) : (
          <div>
            <span className={`${fieldLabel} flex items-center gap-1`}>
              Seats
              <InfoTip label="About seats">
                {holders.length > 1
                  ? `Each sub-row's seats in ${row.scope.code} ${row.group.label}, for every course of the set. Placing fills up to them, and the timetabler is told to expect them added up.`
                  : `${row.scope.code} ${row.group.label}'s seats, for every course of the set. Placing fills up to them, and the timetabler is told to expect this many.`}
              </InfoTip>
            </span>
            <div className={holders.length > 1 ? "mt-1 flex gap-2" : ""}>
              {(holders.length ? holders.map((major) => ({ id: major.id, name: shortProgram(major.program) })) : [{ id: row.group.id, name: "" }]).map(
                (holder) => (
                  <label key={holder.id} className={holders.length > 1 ? "min-w-0 flex-1 text-[11px] text-[#667085]" : ""}>
                    {holders.length > 1 ? holder.name : null}
                    <input
                      aria-label={`Seats for ${holders.length > 1 ? `${holder.name} in ` : ""}${row.scope.code} ${row.group.label}`}
                      value={seats[holder.id] ?? ""}
                      inputMode="numeric"
                      onChange={(event) => setSeats((held) => ({ ...held, [holder.id]: event.target.value.replace(/[^0-9]/g, "") }))}
                      placeholder="—"
                      className={holders.length > 1 ? `${field} mt-0.5` : field}
                    />
                  </label>
                ),
              )}
            </div>
          </div>
        )}
        <label className={fieldLabel}>
          Room preference
          <input aria-label={`Room preference for ${label}`} value={draft.roomPref} onChange={(event) => set({ roomPref: event.target.value })} className={field} />
        </label>
        <label className={fieldLabel}>
          Day preference
          <input aria-label={`Day preference for ${label}`} value={draft.dayPref} onChange={(event) => set({ dayPref: event.target.value })} className={field} />
        </label>
        <label className={fieldLabel}>
          Time preference
          <input aria-label={`Time preference for ${label}`} value={draft.timePref} onChange={(event) => set({ timePref: event.target.value })} className={field} />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>
          Constraints
          <textarea aria-label={`Constraints for ${label}`} value={draft.constraints} rows={2} onChange={(event) => set({ constraints: event.target.value })} placeholder="Should not be in parallel with G.2" className={field} />
        </label>
        <label className={fieldLabel}>
          Comments
          <textarea aria-label={`Comments for ${label}`} value={draft.comments} rows={2} onChange={(event) => set({ comments: event.target.value })} placeholder="Mutualised with Maths" className={field} />
        </label>
      </div>
      {save.error ? <p role="alert" className="mt-3 text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
    </Modal>
  );
}
