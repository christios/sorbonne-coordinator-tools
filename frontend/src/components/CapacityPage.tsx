import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy } from "lucide-react";
import { Tooltip } from "radix-ui";
import { type ReactNode, useMemo, useState } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { InfoTip } from "@/components/InfoTip";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { useRemembered } from "@/components/useRemembered";
import {
  capacityByGroup,
  capacityBySet,
  capacityRows,
  groupTotals,
  lineCrns,
  roomReading,
  type CapacityStatus,
  type GroupCapacity,
  type RoomReading,
  type RoomUse,
} from "@/services/capacity";
import { copyTable } from "@/services/copyCells";
import { COHORT } from "@/services/remembered";
import { type ActiveCrn, fetchActiveCourses, fetchActiveCrns, fetchActiveTeachers, fetchFacilitySections, fetchTermLinks } from "@/services/portalLists";
import { useRooms } from "@/services/rooms";
import { formatDayAndMonth, formatRoom } from "@/services/weekSchedule";
import { fetchCohorts, fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/*
 * One hue for "how full", and the status colours this application already uses for the
 * two answers that need acting on. Never colour alone: every bar carries its numbers and
 * its word, so the reading survives a colourblind eye and a printer.
 */
const FILL: Record<CapacityStatus, string> = {
  Over: "#a6292f",
  Full: "#2e7d55",
  Room: "#1f4e79",
  Empty: "#c8d0da",
  "No capacity set": "#98a2b3",
};

const WORD: Record<CapacityStatus, string> = {
  Over: "over capacity",
  Full: "full",
  Room: "room",
  Empty: "nobody yet",
  "No capacity set": "no capacity set",
};

function Tile({ label, value, hint, alarm }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${alarm ? "border-[#e5b7b9] bg-[#fdf3f3]" : "border-[#d9dee7] bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alarm ? "text-[#a6292f]" : "text-[#171717]"}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[#98a2b3]">{hint}</p> : null}
    </div>
  );
}

/*
 * The bar is the group's own seats, not the set's biggest group.
 *
 * Scaling every bar to the fullest group in its set made "over capacity" invisible: a
 * class of 34 in 33 seats drew at 94% of the row, red but plainly not full, and the eye
 * believed the picture over the colour. So the track *is* the capacity — its right edge
 * is the last seat — and anything beyond it sticks out past that edge in the colour that
 * says so. Full looks full, over looks over, and half-empty looks half-empty.
 *
 * A quarter of the row is kept clear for the overflow; a group more than a quarter over
 * fills that lane and the number beside it carries the rest.
 */
const TRACK = 76;
const SPILL = 24;

/**
 * One group as a bar: the seats as the track, the students as the fill, the rest spilling —
 * with its sections named underneath.
 *
 * The sections used to be behind a chevron, which meant the answer to "who teaches this
 * class" was a click away on every row, and the click's reward was a list you then had to
 * close again. They are one line under the bar now, and each opens its own CRN rather than
 * opening nothing.
 */
/** Where a CRN usually meets — the room most of its classes are in — and what that room seats. */
type UsualRoom = { name: string; seats: number | null };

/** "12 sessions", "1 session". */
const sessions = (count: number) => `${count} session${count === 1 ? "" : "s"}`;

/**
 * Every room a line meets in, on hover: what each seats and how many of its sessions are
 * booked there — the room it is read against first, and any too small for it marked.
 */
/**
 * Which classes a room is for: the course and its days where there are few, as for a room
 * a lecture was moved to once — "PHYS-125 · 3 Nov" — and the course with a count where it
 * is the course's own room, whose thirty dates would say nothing.
 */
function roomClasses(room: RoomUse): string {
  return room.classes
    .map((held) =>
      held.dates.length <= 4
        ? `${held.course} · ${[...new Set(held.dates)]
            .map((day) => {
              // Two sessions the same day are one date, said twice over: "18 Sep ×2".
              const times = held.dates.filter((other) => other === day).length;
              return `${formatDayAndMonth(day)}${times > 1 ? ` ×${times}` : ""}`;
            })
            .join(", ")}`
        : `${held.course} · ${sessions(held.dates.length)}`,
    )
    .join(" — ");
}

function RoomsTip({ reading, who, children }: { reading: RoomReading; who?: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="cursor-default">{children}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="left"
            align="center"
            sideOffset={6}
            collisionPadding={12}
            className="z-[130] max-w-md rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-xs leading-5 text-[#475467] shadow-lg"
          >
            {/* Whose classes these are: the whole group's, or one programme's own. */}
            {who ? <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">{who}</p> : null}
            <p className="font-semibold text-[#344054]">
              {reading.main
                ? `${reading.enrolled} in ${reading.main.name}, ${reading.main.seats} seats`
                : `${reading.enrolled} — no room with known seats`}
              <span className="font-normal text-[#667085]"> · our plan {reading.planned || "—"}</span>
            </p>
            {reading.rooms.length ? (
              <ul className="mt-1 space-y-0.5">
                {reading.rooms.map((room) => {
                  const small = reading.tooSmall.includes(room);
                  return (
                    <li key={room.name} className={small ? "text-[#a6292f]" : ""}>
                      <span className="flex justify-between gap-4">
                        <span>
                          {room.name}
                          {room === reading.main ? <span className="text-[#98a2b3]"> · most sessions</span> : null}
                          {small ? " · too small" : ""}
                        </span>
                        <span className="tabular-nums">
                          {room.seats !== null ? `${room.seats} seats` : "seats not known"} · {sessions(room.sessions)}
                        </span>
                      </span>
                      <span className={`block text-[11px] ${small ? "text-[#c0666b]" : "text-[#98a2b3]"}`}>{roomClasses(room)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-[#98a2b3]">No sessions booked in a room yet, so it is read against our plan.</p>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function GroupBar({
  group,
  peak,
  onOpenCrn,
  roomFor,
  reading,
}: {
  group: GroupCapacity;
  peak: number;
  onOpenCrn: (crn: string) => void;
  roomFor?: (crn: string) => UsualRoom | null;
  /** The line against its room, with our plan beside it — see RoomReading. */
  reading: RoomReading;
}) {
  const against = reading.against;
  const stated = against > 0;
  const filled = stated ? Math.min(1, group.enrolled / against) : Math.min(1, group.enrolled / peak);
  const over = stated ? Math.max(0, group.enrolled - against) : 0;
  // The spill is drawn to the same scale as the track, so one seat is one width either side.
  const spill = stated ? Math.min(SPILL, (over / against) * TRACK) : 0;

  return (
    <div className="py-1.5">
      <div className="flex w-full items-center gap-3 text-left">
        <span className="w-32 shrink-0 truncate text-sm font-medium text-[#344054]" title={group.group}>{group.group}</span>

        <span className="relative h-3.5 min-w-0 flex-1">
          {/* The seats: the whole track, whatever the group holds. */}
          <span
            className={`absolute inset-y-0 left-0 rounded-sm ${stated ? "bg-[#eef1f5]" : "bg-transparent"}`}
            style={{ width: `${TRACK}%` }}
          />
          <span
            className="absolute inset-y-0 left-0 rounded-l-sm"
            style={{ width: `${filled * TRACK}%`, background: FILL[reading.status] }}
          />
          {/* The last seat, so full reads as full at a glance. */}
          {stated ? (
            <span className="absolute inset-y-[-2px] w-px bg-[#b7bec8]" style={{ left: `${TRACK}%` }} />
          ) : null}
          {spill ? (
            <span
              className="absolute inset-y-0 rounded-r-sm bg-[#a6292f]"
              style={{ left: `${TRACK}%`, width: `${spill}%` }}
              title={`${over} over its seats`}
            />
          ) : null}
        </span>

        {/*
          * Students against the room they are booked in, and our plan under it. The room is
          * the one most of its sessions are in; the others, and what each seats, are a hover
          * away — and said here when there are several, or when one is too small for them.
          */}
        <RoomsTip reading={reading} who={group.part ? `${group.part} only` : `Group ${group.group}'s classes`}>
          <span className="block w-36 shrink-0 text-right leading-tight">
            <span className="text-sm tabular-nums text-[#344054]">
              {group.enrolled}
              <span className="text-[#98a2b3]"> / {against || "—"}</span>
            </span>
            <span className="block text-[11px] text-[#98a2b3]">
              {reading.byRoom ? `plan ${reading.planned || "—"}` : "our plan · room not known"}
              {reading.rooms.length > 1 ? ` · ${reading.rooms.length} rooms` : ""}
            </span>
          </span>
        </RoomsTip>
        <span className="w-36 shrink-0 text-right text-xs leading-tight">
          <span className={`block ${over ? "font-semibold text-[#a6292f]" : reading.overPlan ? "font-semibold text-[#8a6116]" : "text-[#98a2b3]"}`}>
            {over ? (
              <>
                <AlertTriangle size={11} className="mr-1 inline align-[-1px]" aria-hidden="true" />
                {over} over the room
              </>
            ) : reading.overPlan && reading.byRoom ? (
              `${reading.overPlan} over plan`
            ) : stated && reading.free > 0 ? (
              `${reading.free} free`
            ) : (
              WORD[reading.status]
            )}
          </span>
          {reading.tooSmallSessions ? (
            <span className="block text-[11px] text-[#8a6116]">{sessions(reading.tooSmallSessions)} in rooms too small</span>
          ) : null}
        </span>
      </div>

      {/*
        * Every section of the group, named and pressable.
        *
        * A section with no CRN is still shown — the course and whoever is down to teach it
        * are the useful part, and a missing CRN is itself worth seeing — but it opens
        * nothing, because there is nothing to open.
        */}
      {group.sections.length ? (
        <ul className="ml-[8.5rem] mt-1 flex flex-wrap gap-1">
          {/*
            * A shared class is one room that four years sit in, and its record is kept by
            * each of them. How full it is reads differently once you know the students in
            * it are not all one cohort's.
            */}
          {group.cohortNames.length > 1 ? (
            <li>
              <span
                title={`Students from ${group.cohortNames.join(", ")} are in this class`}
                className="inline-flex items-center rounded-full bg-[#e8edf3] px-2 py-0.5 text-xs font-semibold text-[#1f4e79]"
              >
                {group.cohortNames.length} cohorts
              </span>
            </li>
          ) : null}
          {group.sections.map((section) => {
            /*
             * On a programme's line, a lecture it shares says with whom, and how many sit in it
             * — the room has to hold all of them, not this line's share.
             */
            const sharedWith =
              group.part && !section.part ? section.parts.map((part) => part.name).filter((name) => name !== group.part) : [];
            const said = `${section.courseCode}${section.component ? ` ${section.component}` : ""}${
              sharedWith.length ? ` · with ${sharedWith.join(" and ")}` : ""
            } · ${section.teacher || "no teacher yet"}`;
            /*
             * The room it is booked in, beside the group's seats: a group of 30 seats timetabled
             * into a room of 24 is full at 24, whatever the bar says.
             */
            const room = section.crn && roomFor ? roomFor(section.crn) : null;
            // Against whoever takes this class — the part, for a part's class.
            const small = Boolean(room && room.seats !== null && section.enrolled > room.seats);
            return (
              <li key={section.key}>
                {section.crn ? (
                  <button
                    type="button"
                    onClick={() => onOpenCrn(section.crn)}
                    title={`Open ${section.crn} — ${said}${
                      room ? ` · ${room.name}${room.seats !== null ? `, ${room.seats} seats` : ", seats not known"}${small ? ` — fewer than the ${section.enrolled} in it` : ""}` : ""
                    }`}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-full border bg-white px-2 py-0.5 text-xs text-[#667085] hover:bg-[#f2f7fb] hover:text-[#1f4e79] ${
                      small ? "border-[#efc9cb] hover:border-[#e5a3a7]" : "border-[#e4e8ef] hover:border-[#b7cbe0]"
                    }`}
                  >
                    <span className="tabular-nums font-semibold text-[#344054]">{section.crn}</span>
                    <span className="min-w-0 truncate">{said}</span>
                    {room ? (
                      <span className={`shrink-0 tabular-nums ${small ? "font-semibold text-[#a6292f]" : "text-[#98a2b3]"}`}>
                        {room.name}
                        {room.seats !== null ? ` · ${room.seats} seats` : ""}
                        {sharedWith.length ? ` · ${section.enrolled} in it` : ""}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <span
                    title={said}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed border-[#e4e8ef] px-2 py-0.5 text-xs text-[#98a2b3]"
                  >
                    <span className="font-semibold">no CRN</span>
                    <span className="min-w-0 truncate">{said}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * How full every group is — the Capacity sheet the workbooks carried, read as an answer
 * rather than as a sheet.
 *
 * One cohort at a time, because that is the unit a coordinator moves students within: the
 * question is never "how full is the department", it is "where do I put this student, and
 * which class have I broken". So the totals come first, then every set with its groups
 * drawn to one scale, worst first.
 *
 * Sets open to every cohort — the languages — stand apart at the end: they hold this
 * cohort's students among everybody else's, and their seats are not this cohort's to
 * count.
 */
export function CapacityPage() {
  const client = useQueryClient();
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  // The same cohort Groups & CRNs and the Group schema are on, remembered by this browser.
  const [cohortId, setCohortId] = useRemembered(COHORT);
  /*
   * Which CRN's profile is open. There is no expanding left to do on this page — the
   * sections are always named — so pressing one goes where a coordinator was heading.
   */
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });
  const openCrn = (crn: string) => {
    const held = (registered.data ?? []).find((entry) => entry.crn === crn);
    if (held) setShowingCrn(held);
  };

  const rows = useMemo(() => {
    const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
    const teacherName = (id: string) => (teachers.data ?? []).find((teacher) => teacher.id === id)?.fullName ?? "";
    return capacityRows(catalogues.data ?? [], termName, courses.data ?? [], teacherName);
  }, [catalogues.data, terms.data, courses.data, teachers.data]);

  // The cohorts themselves, for the headcount: how many students a cohort holds is the
  // cohort's own fact, and its groups cannot be added up to give it.
  const known = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts });
  const cohorts = useMemo(() => {
    const held = new Map<string, string>();
    // Named by the cohorts that have groups of their own: a year is not in the list
    // because it happens to hold the row for a set everybody shares.
    for (const row of rows) if (!row.shared) held.set(row.cohortId, row.cohortName);
    return [...held.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [rows]);

  const chosen = cohorts.find((cohort) => cohort.id === cohortId) ?? cohorts[0] ?? null;
  /*
   * This cohort's own, and the department's.
   *
   * A set open to every cohort is filed under whichever one holds its row — the languages
   * under Foundation Year — so asking for a cohort's rows showed them to that cohort and
   * to nobody else. They belong to every year, and are shown to every year.
   *
   * They are kept out of the totals, though: twenty language groups would swamp L2's four,
   * and their seats are not L2's to count. The shared sets carry their own numbers below.
   */
  const mine = useMemo(() => rows.filter((row) => row.cohortId === chosen?.id && !row.shared), [rows, chosen]);
  const everyones = useMemo(() => rows.filter((row) => row.shared), [rows]);
  const sets = useMemo(
    () => [...capacityBySet(capacityByGroup(mine)), ...capacityBySet(capacityByGroup(everyones))],
    [mine, everyones],
  );
  const totals = useMemo(() => groupTotals(mine), [mine]);
  /*
   * Where each CRN on the page usually meets, from the portal's timetable, and what that
   * room seats — beside each group's own seats.
   */
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const crnsByTerm = useMemo(() => {
    const held = new Map<string, Set<string>>();
    for (const row of [...mine, ...everyones]) {
      const termCode = links.data?.[row.termId] ?? "";
      if (termCode && row.crn) held.set(termCode, (held.get(termCode) ?? new Set()).add(row.crn));
    }
    return [...held.entries()].map(([termCode, crns]) => ({ termCode, crns: [...crns].sort() }));
  }, [mine, everyones, links.data]);
  const sweeps = useQueries({
    queries: crnsByTerm.map(({ termCode, crns }) => ({
      queryKey: ["facility-sections", termCode, crns.join(",")],
      queryFn: () => fetchFacilitySections(termCode, crns),
      retry: false,
    })),
  });
  const { roomOf } = useRooms();
  const { usual, roomsByCrn } = useMemo(() => {
    const usual = new Map<string, UsualRoom>();
    // Every room each CRN's sessions are booked in, under the rooms list's name, with a count.
    const roomsByCrn = new Map<string, RoomUse[]>();
    for (const read of sweeps) {
      for (const section of read.data?.sections ?? []) {
        const counts = new Map<string, RoomUse>();
        const course = section.courseCode || section.crn;
        for (const meeting of section.meetings) {
          if (!meeting.room) continue;
          const known = roomOf(meeting.room);
          const name = known?.code ?? formatRoom(meeting.room);
          const seen = counts.get(name) ?? { name, seats: known?.seats ?? null, sessions: 0, classes: [{ course, dates: [] }] };
          counts.set(name, {
            ...seen,
            sessions: seen.sessions + 1,
            classes: [{ course, dates: [...seen.classes[0].dates, meeting.meetsOn].sort() }],
          });
        }
        const uses = [...counts.values()].sort((left, right) => right.sessions - left.sessions);
        if (!uses.length) continue;
        roomsByCrn.set(section.crn, uses);
        usual.set(section.crn, { name: uses[0].name, seats: uses[0].seats });
      }
    }
    return { usual, roomsByCrn };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the reads, by when each answered: one value however many there are
  }, [roomOf, sweeps.map((read) => read.dataUpdatedAt).join(",")]);
  const roomFor = (crn: string) => usual.get(crn) ?? null;
  const roomsOf = (crn: string) => roomsByCrn.get(crn);
  const readingOf = (group: GroupCapacity) => roomReading(lineCrns(group), roomsOf, group.capacity, group.enrolled);
  /*
   * What is over, now that a line is read against its room: every group or part with more
   * students than its room seats (or than our plan, where no room is known), and apart
   * from them, those the room holds but our plan does not.
   */
  const lines = (groups: GroupCapacity[]) =>
    groups.map((group) => ({ key: group.key, set: group.set, label: group.group, reading: readingOf(group) }));
  const mineLines = lines(capacityByGroup(mine));
  const over = mineLines.filter((line) => line.reading.status === "Over");
  const overPlanOnly = mineLines.filter((line) => line.reading.status !== "Over" && line.reading.byRoom && line.reading.overPlan > 0);
  // The cohort's own headcount, which its groups cannot be added up to give.
  const members = (known.data ?? []).find((cohort) => cohort.id === chosen?.id)?.memberCount ?? 0;

  const copy = () => {
    const rows = sets.flatMap((set) =>
      lines(set.groups).map((line) => [
        set.code,
        line.label,
        String(line.reading.enrolled),
        line.reading.main?.name ?? "",
        line.reading.seats === null ? "" : String(line.reading.seats),
        String(line.reading.planned),
        String(line.reading.free),
        line.reading.status,
        line.reading.rooms.map((room) => `${room.name} (${room.seats ?? "?"} seats, ${sessions(room.sessions)})`).join("; "),
      ]),
    );
    void copyTable(["Set", "Group", "Enrolled", "Room", "Room seats", "Planned seats", "Seats free", "Status", "Every room"], rows);
  };

  if (catalogues.isLoading) return <ScreenLoading label="Counting the seats…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;
  if (!chosen) {
    return (
      <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
        No groups yet. Groups &amp; CRNs is where they are made.
      </p>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <LabelledPicker label="Cohort">
          <SelectMenu
            label="Cohort"
            value={chosen.id}
            onChange={setCohortId}
            options={cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name }))}
          />
        </LabelledPicker>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Copy size={14} aria-hidden="true" /> Copy the numbers
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label="Groups"
          value={String(totals.groups)}
          hint={`${sets.filter((set) => !set.shared).length} set${sets.filter((set) => !set.shared).length === 1 ? "" : "s"} of this cohort's own`}
        />
        {/*
          * Two different numbers, and reading one as the other is what makes a cohort of
          * 152 look like 456: a student sits in a lecture and a tutorial and a practical,
          * and each is a seat taken.
          */}
        <Tile label="Students" value={(members ?? 0).toLocaleString()} hint={`in ${chosen.name}`} />
        <Tile
          label="Seats taken"
          value={totals.placements.toLocaleString()}
          hint={members ? `${(totals.placements / members).toFixed(1)} groups each` : "one per group they sit in"}
        />
        <Tile
          label="Planned seats"
          value={totals.capacity.toLocaleString()}
          hint={totals.withoutCapacity ? `${totals.withoutCapacity} group(s) state none` : "every group states one"}
        />
        <Tile
          label="Over the room"
          value={String(over.length)}
          alarm={over.length > 0}
          hint={
            overPlanOnly.length
              ? `${overPlanOnly.length} more over our plan, within the room`
              : over.length
                ? "these need moving"
                : "nothing over"
          }
        />
      </div>

      <div className="mt-5 space-y-5">
        {sets.map((set) => (
          <section key={set.code} className={`rounded-lg border p-4 ${set.shared ? "border-[#d9dee7] bg-[#f8fafc]" : "border-[#d9dee7] bg-white"}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-[#1f4e79]">{set.code}</h3>
              {set.shared ? (
                <span className="inline-flex items-center gap-1 self-center">
                  <span className="rounded-full bg-[#e8edf3] px-2 py-0.5 text-xs font-semibold text-[#1f4e79]">Across cohorts</span>
                  <InfoTip label="What across cohorts means">
                    Its seats are shared with every cohort: it holds this cohort&apos;s students among everybody else&apos;s,
                    so it is counted apart from the totals above.
                  </InfoTip>
                </span>
              ) : null}
              <p className="text-xs text-[#667085]">
                {set.groupCount} group{set.groupCount === 1 ? "" : "s"}
                {set.groups.length > set.groupCount
                  ? set.groupCount === 1
                    ? ` in ${set.groups.length} parts`
                    : ` · ${set.groups.length} lines, split by programme`
                  : ""}{" "}
                · {set.enrolled.toLocaleString()} in{" "}
                {set.capacity.toLocaleString()} planned seats
                {(() => {
                  const overHere = lines(set.groups).filter((line) => line.reading.status === "Over").length;
                  return overHere ? <span className="font-semibold text-[#a6292f]"> · {overHere} over</span> : null;
                })()}
              </p>
            </div>
            <div className="divide-y divide-[#f2f4f7]">
              {set.groups.map((group) => (
                <GroupBar
                  key={group.key}
                  group={group}
                  peak={set.peak}
                  onOpenCrn={openCrn}
                  roomFor={roomFor}
                  reading={readingOf(group)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(registered.data ?? []).filter(
            (entry) => entry.courseCode === showingCrn.courseCode && entry.termCode === showingCrn.termCode,
          )}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void client.invalidateQueries({ queryKey: ["active-crns"] })}
        />
      ) : null}
    </section>
  );
}
