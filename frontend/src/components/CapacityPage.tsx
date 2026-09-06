import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import {
  capacityByGroup,
  capacityBySet,
  capacityRows,
  groupTotals,
  type CapacityStatus,
  type GroupCapacity,
} from "@/services/capacity";
import { rowText } from "@/services/copyCells";
import { fetchActiveCourses, fetchActiveTeachers } from "@/services/portalLists";
import { fetchCourseCards } from "@/services/studentDatabase";
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

/** One group as a bar: the seats as the track, the students as the fill, the rest spilling. */
function GroupBar({ group, peak, open, onToggle }: { group: GroupCapacity; peak: number; open: boolean; onToggle: () => void }) {
  const stated = group.capacity > 0;
  const filled = stated ? Math.min(1, group.enrolled / group.capacity) : Math.min(1, group.enrolled / peak);
  const over = stated ? Math.max(0, group.enrolled - group.capacity) : 0;
  // The spill is drawn to the same scale as the track, so one seat is one width either side.
  const spill = stated ? Math.min(SPILL, (over / group.capacity) * TRACK) : 0;

  return (
    <div className="py-1.5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />
        )}
        <span className="w-24 shrink-0 truncate text-sm font-medium text-[#344054]">{group.group}</span>

        <span className="relative h-3.5 min-w-0 flex-1">
          {/* The seats: the whole track, whatever the group holds. */}
          <span
            className={`absolute inset-y-0 left-0 rounded-sm ${stated ? "bg-[#eef1f5]" : "bg-transparent"}`}
            style={{ width: `${TRACK}%` }}
          />
          <span
            className="absolute inset-y-0 left-0 rounded-l-sm"
            style={{ width: `${filled * TRACK}%`, background: FILL[group.status] }}
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

        <span className="w-24 shrink-0 text-right text-sm tabular-nums text-[#344054]">
          {group.enrolled}
          <span className="text-[#98a2b3]"> / {group.capacity || "—"}</span>
        </span>
        <span className={`w-32 shrink-0 text-right text-xs ${over ? "font-semibold text-[#a6292f]" : "text-[#98a2b3]"}`}>
          {over ? (
            <>
              <AlertTriangle size={11} className="mr-1 inline align-[-1px]" aria-hidden="true" />
              {over} over
            </>
          ) : stated && group.free > 0 ? (
            `${group.free} free`
          ) : (
            WORD[group.status]
          )}
        </span>
      </button>

      {open ? (
        <ul className="ml-10 mt-1 space-y-0.5 text-xs text-[#667085]">
          {group.sections.map((section) => (
            <li key={section.key} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums text-[#344054]">{section.crn || "no CRN"}</span>
              <span>{section.courseCode}</span>
              {section.component ? <span className="text-[#98a2b3]">{section.component}</span> : null}
              <span className="text-[#98a2b3]">{section.teacher || "no teacher yet"}</span>
            </li>
          ))}
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
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const [cohortId, setCohortId] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
    const teacherName = (id: string) => (teachers.data ?? []).find((teacher) => teacher.id === id)?.fullName ?? "";
    return capacityRows(catalogues.data ?? [], termName, courses.data ?? [], teacherName);
  }, [catalogues.data, terms.data, courses.data, teachers.data]);

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
  const over = useMemo(() => capacityByGroup(mine).filter((group) => group.status === "Over"), [mine]);

  const copy = () => {
    const lines = [rowText(["Set", "Group", "Seats", "Enrolled", "Seats free", "Status"])];
    for (const set of sets) {
      for (const group of set.groups) {
        lines.push(rowText([set.code, group.group, String(group.capacity), String(group.enrolled), String(group.free), group.status]));
      }
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
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

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Groups"
          value={String(totals.groups)}
          hint={`${sets.filter((set) => !set.shared).length} set${sets.filter((set) => !set.shared).length === 1 ? "" : "s"} of this cohort's own`}
        />
        <Tile label="Students placed" value={totals.enrolled.toLocaleString()} hint="counted once per group" />
        <Tile
          label="Seats"
          value={totals.capacity.toLocaleString()}
          hint={totals.withoutCapacity ? `${totals.withoutCapacity} group(s) state none` : "every group states one"}
        />
        <Tile
          label="Over capacity"
          value={String(totals.over)}
          alarm={totals.over > 0}
          hint={totals.over ? "these need moving" : "nothing over"}
        />
      </div>

      {over.length ? (
        <p role="status" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-2.5 text-sm text-[#a6292f]">
          <AlertTriangle size={14} className="mr-1.5 inline align-[-2px]" aria-hidden="true" />
          Over their seats: {over.map((group) => `${group.set} ${group.group} (+${group.enrolled - group.capacity})`).join(", ")}.
        </p>
      ) : null}

      <div className="mt-5 space-y-5">
        {sets.map((set) => (
          <section key={set.code} className={`rounded-lg border p-4 ${set.shared ? "border-[#d9dee7] bg-[#f8fafc]" : "border-[#d9dee7] bg-white"}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-[#1f4e79]">{set.code}</h3>
              {set.shared ? (
                <span className="rounded-full bg-[#e8edf3] px-2 py-0.5 text-xs font-semibold text-[#1f4e79]">Across cohorts</span>
              ) : null}
              <p className="text-xs text-[#667085]">
                {set.groups.length} group{set.groups.length === 1 ? "" : "s"} · {set.enrolled.toLocaleString()} in{" "}
                {set.capacity.toLocaleString()} seats
                {set.over ? <span className="font-semibold text-[#a6292f]"> · {set.over} over</span> : null}
                {set.shared ? " · seats shared with every cohort" : ""}
              </p>
            </div>
            <div className="divide-y divide-[#f2f4f7]">
              {set.groups.map((group) => (
                <GroupBar
                  key={group.key}
                  group={group}
                  peak={set.peak}
                  open={opened.has(group.key)}
                  onToggle={() =>
                    setOpened((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-4 text-xs text-[#98a2b3]">
        A group&apos;s enrolment is the group&apos;s, whatever its set carries: open one to see its sections. Each bar is
        that group&apos;s own seats — the line is the last one — so what spills past it is what is over. A set shared across cohorts holds
        this cohort&apos;s students among everybody else&apos;s, so its seats are counted apart from the totals above.
      </p>
    </section>
  );
}
