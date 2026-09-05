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

/**
 * One group as a bar: its seats as the track, its students as the fill.
 *
 * The scale is the set's fullest group, so the bars of a set are read against each other
 * — which is the question, since a student moved out of one lands in another. A group
 * over its seats overflows the track in the colour that says so, and says by how many.
 */
function GroupBar({ group, peak, open, onToggle }: { group: GroupCapacity; peak: number; open: boolean; onToggle: () => void }) {
  const width = (value: number) => `${Math.min(100, (value / peak) * 100)}%`;
  const over = group.enrolled > group.capacity && group.capacity > 0;
  return (
    <div className="py-1.5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />
        )}
        <span className="w-24 shrink-0 truncate text-sm font-medium text-[#344054]">{group.group}</span>
        <span className="relative h-3 min-w-0 flex-1 rounded-full bg-[#eef1f5]">
          {/* The seats, as a faint track end, so a half-empty group looks half empty. */}
          {group.capacity ? (
            <span className="absolute inset-y-0 left-0 rounded-full bg-[#e2e7ee]" style={{ width: width(group.capacity) }} />
          ) : null}
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: width(group.enrolled), background: FILL[group.status] }}
          />
        </span>
        <span className="w-24 shrink-0 text-right text-sm tabular-nums text-[#344054]">
          {group.enrolled}
          <span className="text-[#98a2b3]"> / {group.capacity || "—"}</span>
        </span>
        <span className={`w-32 shrink-0 text-right text-xs ${over ? "font-semibold text-[#a6292f]" : "text-[#98a2b3]"}`}>
          {over ? (
            <>
              <AlertTriangle size={11} className="mr-1 inline align-[-1px]" aria-hidden="true" />
              {group.enrolled - group.capacity} over
            </>
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
    for (const row of rows) held.set(row.cohortId, row.cohortName);
    return [...held.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [rows]);

  const chosen = cohorts.find((cohort) => cohort.id === cohortId) ?? cohorts[0] ?? null;
  const mine = useMemo(() => rows.filter((row) => row.cohortId === chosen?.id), [rows, chosen]);
  const sets = useMemo(() => capacityBySet(capacityByGroup(mine)), [mine]);
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
        <Tile label="Groups" value={String(totals.groups)} hint={`${sets.length} set${sets.length === 1 ? "" : "s"}`} />
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
        A group&apos;s enrolment is the group&apos;s, whatever its set carries: open one to see its sections. Bars are
        drawn to the fullest group of their set, so a set reads against itself.
      </p>
    </section>
  );
}
