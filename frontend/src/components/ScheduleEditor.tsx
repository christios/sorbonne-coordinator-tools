import { AddEntryButton } from "@/components/AddEntryButton";
import { ArrowDownUp, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { CollapsibleEntryCard } from "@/components/CollapsibleEntryCard";
import { switchCardKind, type CardKind } from "@/services/scheduleCardKind";
import { SelectMenu } from "@/components/SelectMenu";
import { FieldHistoryControl } from "@/components/FieldHistory";
import { FieldRow } from "@/components/FieldRow";
import { FormGrid } from "@/components/FormGrid";
import { FormFieldLabel } from "@/components/FormFieldLabel";
import { RichTextField } from "@/components/RichTextField";
import { SyllabusField } from "@/components/SyllabusField";
import { fieldSizeClass, type FieldSize } from "@/components/fieldSize";
import { HistoryTextField } from "@/components/HistoryTextField";
import { type HistoryField } from "@/components/FieldHistory";
import { GradedActivityFields, type CloKey } from "@/components/StructuredEntryEditors";
import type { CatalogueEntry } from "@/services/syllabusCatalogues";
import { FYS_COMPONENTS, scheduleOrder, sessionHours } from "@/services/syllabusContent";
import { PloAlignmentField } from "@/components/PloAlignmentField";
import { DateField } from "@/components/DateField";

type ScheduleRow = Record<string, string> & { id: string };
type ScheduleField = {
  key: "week" | "duration" | "deadline" | "topic" | "details" | "preClass" | "assessments";
  size?: FieldSize;
  label: string;
  multiline?: boolean;
};

/**
 * Lectures, tutorials and labs are counted separately, so a course reads
 * 1 CM, 2 CM, 1 TD, 3 CM — each kind keeping its own sequence.
 */
export const SESSION_TYPES = [
  { value: "CM", label: "CM — Cours magistral", pill: "bg-[#e8edf3] text-[#1f4e79]" },
  { value: "TD", label: "TD — Travaux dirigés", pill: "bg-[#fdf3e3] text-[#8a6116]" },
  { value: "TP", label: "TP — Travaux pratiques", pill: "bg-[#e9f5ec] text-[#1f6b3a]" },
  // The template's other contact-hour rows, so every row comes from the schedule (10 Nov 2026).
  { value: "Workshop", label: "Workshop", pill: "bg-[#f3e8f7] text-[#6b2c86]" },
  { value: "Seminar", label: "Seminar", pill: "bg-[#e6f4f1] text-[#1d6b5f]" },
  { value: "Other", label: "Other", pill: "bg-[#eef1f5] text-[#344054]" },
] as const;

const DEFAULT_SESSION_TYPE = "CM";

/** A week is a whole number from 1: anything else is a typo worth pointing at. */
export function weekProblem(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (!/^\d+$/.test(text)) return "Enter the week as a number, for example 3.";
  return Number(text) >= 1 ? "" : "Weeks are numbered from 1.";
}

/** A deadline is usually anchored to a week, but some are simply prose. */
export function deadlineForWeek(week: string): string {
  const text = week.trim();
  return /^\d+$/.test(text) ? `End of week ${text}` : "";
}


/** The weeks this schedule actually teaches, in order, each said once. */
function weeksTaught(rows: ScheduleRow[]): string[] {
  const seen = new Set<string>();
  rows.forEach((row) => {
    const week = (row.week ?? "").trim();
    if (/^\d+$/.test(week)) seen.add(week);
  });
  return [...seen].sort((left, right) => Number(left) - Number(right));
}

function weekDeadlineOptions(weeks: string[], current: string) {
  const options = weeks.map((week) => ({ value: deadlineForWeek(week), label: deadlineForWeek(week) }));
  // Whatever the row already says stays on offer, even if its week has since been changed.
  return current && !options.some((option) => option.value === current)
    ? [{ value: current, label: current }, ...options]
    : options;
}

/**
 * Which shape this row's deadline is in.
 *
 * Chosen deliberately once anyone touches the toggle; until then it is read from the value,
 * so a deadline already written as a week keeps offering weeks.
 */
function deadlineMode(row: ScheduleRow, weeks: string[]): "week" | "text" {
  const chosen = row.deadlineMode;
  if (chosen === "week" || chosen === "text") return chosen;
  const value = (row.deadline ?? "").trim();
  if (!value) return "week";
  return weeks.some((week) => deadlineForWeek(week) === value) ? "week" : "text";
}


type Props = {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
  /**
   * Set once the syllabus keeps its graded activities in the schedule (November 2026): a
   * card is then a session or a graded activity, cards go in week order, and sessions no
   * longer carry their own deadline and assessment notes.
   */
  holdsGradedActivities?: boolean;
  /** The Foundation Year form: a graded card names the row of its assessment tables it fills. */
  foundationYear?: boolean;
  outcomes?: Array<Record<string, string> & { id: string }>;
  cloKey?: CloKey;
  assessmentTypes?: CatalogueEntry[];
  aiPolicies?: CatalogueEntry[];
  /**
   * A card asked for from the list of what is still to fill in (11 Nov 2026): it unfolds,
   * comes into view and is marked for a moment. A new count asks again for the same card.
   */
  reveal?: { id: string; count: number } | null;
};


/** A session's first line on the card's twelve columns, matching a graded card's. */
const SESSION_SPAN = {
  sessionType: "col-span-12 @md:col-span-6 @4xl:col-span-7",
  week: "col-span-12 @md:col-span-3 @4xl:col-span-2",
  duration: "col-span-12 @md:col-span-3 @4xl:col-span-3",
  deadline: "col-span-12 @4xl:col-span-5",
};

const fields: ScheduleField[] = [
  { key: "week", label: "Week", size: "counter" },
  // The contact hours in the document are these added up by session type (10 Nov 2026).
  { key: "duration", label: "Length (hours)", size: "counter" },
  { key: "deadline", label: "Deadline", size: "name" },
  { key: "topic", label: "Topic", size: "line" },
  { key: "details", label: "Session details", multiline: true },
  { key: "preClass", label: "Pre-class learning activities", multiline: true },
  { key: "assessments", label: "Assessments", multiline: true },
] as const;

export function ScheduleEditor({
  rows,
  onChange,
  syllabusId,
  revision,
  onOpenHistory,
  holdsGradedActivities = false,
  foundationYear = false,
  outcomes = [],
  cloKey = "cloIds",
  assessmentTypes = [],
  aiPolicies = [],
  reveal = null,
}: Props) {
  // A card opens by itself only while it is blank: a session without a topic, a graded
  // activity without a name or a type.
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    rows
      .filter((row) => (row.kind === "graded" ? !row.name?.trim() && !row.type?.trim() : !row.topic?.trim()))
      .map((row) => row.id),
  );
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (!reveal) return;
    setExpandedIds((current) => (current.includes(reveal.id) ? current : [...current, reveal.id]));
    setHighlightedId(reveal.id);
    // Once the card has unfolded: bring it into view and give its toggle the focus.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const card = document.getElementById(`schedule-${reveal.id}`);
        card?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        card?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
      });
    });
    const timer = window.setTimeout(() => setHighlightedId(null), 2400);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [reveal]);
  const [moveQuery, setMoveQuery] = useState("");

  useEffect(() => {
    if (!movingRowId) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-schedule-move-menu]")
      ) {
        setMovingRowId(null);
        setMoveQuery("");
      }
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    return () =>
      document.removeEventListener("pointerdown", closeWhenClickingAway);
  }, [movingRowId]);

  const toggleExpanded = (id: string) =>
    setExpandedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const weeksInUse = weeksTaught(rows);
  const shown = holdsGradedActivities ? scheduleOrder(rows) : rows;
  const sessionNumbers = new Map<string, number>();
  const gradedNumbers = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of shown) {
    if (row.kind === "graded") {
      gradedNumbers.set(row.id, gradedNumbers.size + 1);
      continue;
    }
    const type = row.sessionType || DEFAULT_SESSION_TYPE;
    const next = (counts.get(type) ?? 0) + 1;
    counts.set(type, next);
    sessionNumbers.set(row.id, next);
  }
  const updateRow = (id: string, key: string, value: string) =>
    onChange(
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const removeRow = (id: string) =>
    onChange(rows.filter((row) => row.id !== id));
  const updateCard = (id: string, changes: Record<string, unknown>) =>
    onChange(rows.map((row) => (row.id === id ? ({ ...row, ...changes } as ScheduleRow) : row)));
  /*
   * A session made a graded activity, or back (11 Nov 2026). The card is rebuilt as the other
   * kind — another height, perhaps another place in the week order — so it is held where it was
   * on screen, before anything is painted, and keeps the focus. Scrolling to it instead made
   * the page jump and the editor's header fold and unfold: "everything flickers".
   */
  const switchAnchor = useRef<{ id: string; top: number } | null>(null);
  const switchKind = (id: string, to: CardKind) => {
    const card = document.getElementById(`schedule-${id}`);
    switchAnchor.current = card ? { id, top: card.getBoundingClientRect().top } : null;
    onChange(rows.map((row) => (row.id === id ? switchCardKind(row, to) : row)));
  };
  useLayoutEffect(() => {
    const anchor = switchAnchor.current;
    if (!anchor) return;
    switchAnchor.current = null;
    const card = document.getElementById(`schedule-${anchor.id}`);
    if (!card) return;
    card.querySelector<HTMLButtonElement>("[data-card-kind] [aria-pressed=true]")?.focus({ preventScroll: true });
    const moved = card.getBoundingClientRect().top - anchor.top;
    const scroller = scrollParent(card);
    if (!scroller || Math.abs(moved) < 1) return;
    // Said to be ours, so the editor's header does not take it for the teacher scrolling.
    scroller.dataset.quietScroll = "true";
    scroller.scrollTop += moved;
    // Where it cannot be held (the list ends too soon to scroll that far), it comes into view.
    const view = scroller.getBoundingClientRect();
    const top = card.getBoundingClientRect().top;
    if (top < view.top || top > view.bottom - 64) scroller.scrollTop += top - view.top - 16;
  }, [rows]);
  const addGraded = () => {
    const id = crypto.randomUUID();
    onChange([...rows, { id, kind: "graded", week: "", date: "", name: "", weight: "" }]);
    setExpandedIds((current) => [...current, id]);
    window.requestAnimationFrame(() =>
      document.getElementById(`schedule-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  const addRow = () => {
    const id = crypto.randomUUID();
    onChange([
      ...rows,
      holdsGradedActivities
        ? { id, sessionType: DEFAULT_SESSION_TYPE, week: "", topic: "", details: "", preClass: "" }
        : { id, sessionType: DEFAULT_SESSION_TYPE, week: "", deadline: "", topic: "", details: "", preClass: "", assessments: "" },
    ]);
    setExpandedIds((current) => [...current, id]);
    window.requestAnimationFrame(() =>
      document
        .getElementById(`schedule-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  const moveRowBefore = (sourceId: string, destinationId?: string) => {
    const source = rows.find((row) => row.id === sourceId);
    if (!source) return;
    const withoutSource = rows.filter((row) => row.id !== sourceId);
    const destinationIndex = destinationId
      ? withoutSource.findIndex((row) => row.id === destinationId)
      : withoutSource.length;
    onChange([
      ...withoutSource.slice(0, destinationIndex),
      source,
      ...withoutSource.slice(destinationIndex),
    ]);
    setMovingRowId(null);
    setMoveQuery("");
  };

  return (
    <section className="mt-2">
      <h4 className="mb-3 text-sm font-semibold text-[#344054]">{holdsGradedActivities ? "Sessions and graded activities" : "Sessions"}</h4>
      {rows.length ? (
        <>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {shown.map((row, index) => {
            const isExpanded = expandedIds.includes(row.id);
            if (row.kind === "graded")
              return (
                <GradedCard
                  key={row.id}
                  card={row}
                  number={gradedNumbers.get(row.id) ?? index + 1}
                  expanded={isExpanded}
                  highlighted={highlightedId === row.id}
                  onToggle={() => toggleExpanded(row.id)}
                  onChange={(changes) => updateCard(row.id, changes)}
                  onSwitchKind={() => switchKind(row.id, "session")}
                  onRemove={() => removeRow(row.id)}
                  outcomes={outcomes}
                  cloKey={cloKey}
                  assessmentTypes={assessmentTypes}
                  aiPolicies={aiPolicies}
                  foundationYear={foundationYear}
                  syllabusId={syllabusId}
                  revision={revision}
                  onOpenHistory={onOpenHistory}
                />
              );
            const destinations = rows.filter(
              (item) =>
                item.id !== row.id &&
                scheduleSummary(item)
                  .toLowerCase()
                  .includes(moveQuery.toLowerCase()),
            );
            return (
              <CollapsibleEntryCard
                key={row.id}
                id={`schedule-${row.id}`}
                expanded={isExpanded}
                highlighted={highlightedId === row.id}
                onToggle={() => toggleExpanded(row.id)}
                toggleLabel={`${isExpanded ? "Collapse" : "Expand"} topic: ${topicLabel(row)} (position ${index + 1})`}
                title={topicLabel(row)}
                summary={[row.week ? `Week ${row.week}` : "No week set", lengthLabel(row)].filter(Boolean).join(" · ")}
                leading={
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1">
                    <span
                      aria-label={`Session ${row.sessionType || DEFAULT_SESSION_TYPE} ${sessionNumbers.get(row.id) ?? index + 1}`}
                      className={`inline-flex h-5 items-center justify-center rounded-full px-2 text-xs font-semibold ${
                        SESSION_TYPES.find((item) => item.value === (row.sessionType || DEFAULT_SESSION_TYPE))?.pill ??
                        "bg-[#eef1f5] text-[#344054]"
                      }`}
                    >
                      {row.sessionType || DEFAULT_SESSION_TYPE}
                    </span>
                    <span className="inline-flex h-5 min-w-7 items-center justify-center rounded-full bg-[#eef1f5] px-1.5 text-xs font-semibold tabular-nums text-[#344054]">
                      {sessionNumbers.get(row.id) ?? index + 1}
                    </span>
                  </span>
                }
                actions={
                  <div data-schedule-move-menu className="contents">
                    <button
                      type="button"
                      onClick={() => {
                        setMovingRowId(row.id);
                        setMoveQuery("");
                      }}
                      className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]"
                      aria-label={`Move topic: ${topicLabel(row)} (position ${index + 1})`}
                      title="Move session"
                    >
                      <ArrowDownUp size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]"
                      aria-label={`Remove topic: ${topicLabel(row)} (position ${index + 1})`}
                      title="Remove session"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                }
                overlay={
                  movingRowId === row.id ? (
                    <div
                      data-schedule-move-menu
                      className="absolute right-0 top-full z-[90] isolate mt-2 w-80 rounded-lg border border-[#c3cbd6] bg-white p-3 opacity-100 shadow-lg"
                    >
                      <p className="text-sm font-semibold text-[#344054]">
                        Place this session before
                      </p>
                      <input
                        type="search"
                        value={moveQuery}
                        onChange={(event) => setMoveQuery(event.target.value)}
                        placeholder="Search destination sessions"
                        className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
                        autoFocus
                      />
                      <div className="mt-2 max-h-56 overflow-y-auto">
                        {destinations.map((destination, destinationIndex) => (
                          <button
                            type="button"
                            key={destination.id}
                            onClick={() =>
                              moveRowBefore(row.id, destination.id)
                            }
                            className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]"
                          >
                            <span className="text-[#475467]">
                              {destinationIndex + 1}.{" "}
                            </span>
                            {scheduleSummary(destination)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => moveRowBefore(row.id)}
                        className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                      >
                        Move to end
                      </button>
                    </div>
                  ) : null
                }
              >
                <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
                  {holdsGradedActivities ? (
                    <CardKindSwitch kind="session" title={topicLabel(row)} onSwitch={() => switchKind(row.id, "graded")} />
                  ) : null}
                  <FormGrid>
                  <SyllabusField
                    className={SESSION_SPAN.sessionType}
                    label="Session type"
                    required
                    fieldKey={`schedule[${row.id}].sessionType`}
                    hint="Which kind of session this is. The numbering runs separately for each kind, so a course has its own CM 1, TD 1 and TP 1."
                  >
                    <SelectMenu
                      label={`Session ${sessionNumbers.get(row.id) ?? index + 1} type`}
                      value={row.sessionType || DEFAULT_SESSION_TYPE}
                      onChange={(next) => updateRow(row.id, "sessionType", next)}
                      wrap
                      options={SESSION_TYPES.map((item) => ({ value: item.value, label: item.label }))}
                    />
                  </SyllabusField>
                  {fields.map((field) => {
                    const value = row[field.key] ?? "";
                    const historyField = {
                      path: `schedule[${row.id}].${field.key}`,
                      label: `Course schedule · ${field.label}`,
                    };
                    if (field.key === "duration") {
                      return (
                        <div key={field.key} className={SESSION_SPAN.duration}>
                          <HistoryTextField
                            label={field.label}
                            required
                            value={value}
                            onChange={(next) => updateRow(row.id, field.key, next)}
                            type="number"
                            min={0.25}
                            step={0.25}
                            hint="How long this session lasts. The syllabus's contact hours (lectures, tutorials and so on) are these lengths added up by session type."
                            history={{ field: historyField, onOpenHistory }}
                          />
                        </div>
                      );
                    }
                    if (field.key === "week") {
                      const problem = weekProblem(value);
                      return (
                        <div key={field.key} className={SESSION_SPAN.week}>
                          <HistoryTextField
                            label={field.label}
                            required
                            value={value}
                            onChange={(next) => updateRow(row.id, field.key, next)}
                            type="number"
                            min={1}
                            step={1}
                            invalid={Boolean(problem)}
                            history={{ field: historyField, onOpenHistory }}
                          />
                          {problem ? <p role="alert" className="mt-1 text-sm text-[#a6292f]">{problem}</p> : null}
                        </div>
                      );
                    }
                    if (field.key === "deadline" && holdsGradedActivities) return null;
                    if (field.key === "deadline") {
                      const byWeek = deadlineMode(row, weeksInUse) === "week";
                      return (
                        <div key={field.key} className={SESSION_SPAN.deadline}>
                          <div className="grid content-start gap-1 text-sm font-medium text-[#344054]">
                            <span className="flex flex-wrap items-center justify-between gap-2">
                              <FormFieldLabel
                                fieldKey={historyField.path}
                                hint="Most deadlines fall at the end of a week this course already teaches, so the weeks in the schedule are offered. Anything that does not — “Before the field trip” — is written out instead."
                              >
                                {field.label}
                              </FormFieldLabel>
                              {/* The two shapes a deadline takes, rather than one box asked to be both. */}
                              <span className="inline-flex shrink-0 rounded-md border border-[#b7bec8] bg-white p-0.5">
                                {([["week", "A week"], ["text", "Free text"]] as const).map(([mode, modeLabel]) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    aria-pressed={byWeek === (mode === "week")}
                                    onClick={() => updateRow(row.id, "deadlineMode", mode)}
                                    className={`rounded px-2 py-0.5 text-xs font-semibold ${byWeek === (mode === "week") ? "bg-[#1f4e79] text-white" : "text-[#1f4e79] hover:bg-[#f2f7fb]"}`}
                                  >
                                    {modeLabel}
                                  </button>
                                ))}
                              </span>
                            </span>
                            {byWeek ? (
                              <SelectMenu
                                label={`Session ${sessionNumbers.get(row.id) ?? index + 1} deadline week`}
                                value={value}
                                onChange={(next) => updateRow(row.id, field.key, next)}
                                wrap
                                placeholder={weeksInUse.length ? "Choose a week" : "No weeks set on this schedule yet"}
                                options={weekDeadlineOptions(weeksInUse, value)}
                                trailing={<FieldHistoryControl field={historyField} onOpenSidebar={onOpenHistory} />}
                              />
                            ) : (
                              <HistoryTextField
                                label={field.label}
                                value={value}
                                onChange={(next) => updateRow(row.id, field.key, next)}
                                grow
                                className="[&>span:first-child]:hidden"
                                history={{ field: historyField, onOpenHistory }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (field.multiline) return null;
                    return (
                      <HistoryTextField
                        key={field.key}
                        label={field.label}
                        required={field.key === "topic"}
                        value={value}
                        onChange={(next) => updateRow(row.id, field.key, next)}
                        className="col-span-12"
                        grow
                        history={{ field: historyField, onOpenHistory }}
                      />
                    );
                  })}
                  </FormGrid>
                  {/* The session written out, with the two shorter answers about it stacked
                      alongside rather than underneath: all three are read together. */}
                  <div className="@container"><div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:grid-cols-2">
                    <RichTextField
                      label="Session details"
                      required
                      value={row.details ?? ""}
                      onChange={(next) => updateRow(row.id, "details", next)}
                      hint="Write the session out as you would for a student: headings for its parts, a list where it is a list. The formatting carries into the exported document."
                      history={{
                        field: { path: `schedule[${row.id}].details`, label: "Course schedule · Session details" },
                        onOpenHistory,
                      }}
                    />
                    <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 ${holdsGradedActivities ? "" : "grid-rows-2"}`}>
                      {holdsGradedActivities ? <EarlierNote row={row} onRemove={() => onChange(rows.map((item) => (item.id === row.id ? { ...item, assessments: "", deadline: "" } : item)))} /> : null}
                      {(holdsGradedActivities ? (["preClass"] as const) : (["preClass", "assessments"] as const)).map((key) => (
                        <HistoryTextField
                          key={key}
                          label={fields.find((field) => field.key === key)?.label ?? key}
                          value={row[key] ?? ""}
                          onChange={(next) => updateRow(row.id, key, next)}
                          multiline
                          fill
                          minRows={3}
                          history={{
                            field: {
                              path: `schedule[${row.id}].${key}`,
                              label: `Course schedule · ${fields.find((field) => field.key === key)?.label ?? key}`,
                            },
                            onOpenHistory,
                          }}
                        />
                      ))}
                    </div>
                  </div></div>
                </div>
              </CollapsibleEntryCard>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4">
          <AddEntryButton onClick={addRow} label="Add session" ariaLabel="Add session at end" />
          {holdsGradedActivities ? <AddEntryButton onClick={addGraded} label="Add graded activity" /> : null}
        </div>
        </>
      ) : (
        <>
        <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#475467]">
          {holdsGradedActivities ? "No sessions or graded activities added yet." : "No sessions added yet."}
        </p>
        <div className="flex flex-wrap gap-x-4">
          <AddEntryButton onClick={addRow} label="Add session" />
          {holdsGradedActivities ? <AddEntryButton onClick={addGraded} label="Add graded activity" /> : null}
        </div>
        </>
      )}
    </section>
  );
}

function topicLabel(row: ScheduleRow) {
  return row.topic?.trim() || "Untitled topic";
}

function scheduleSummary(row: ScheduleRow) {
  return `${topicLabel(row)}${row.week ? ` · week ${row.week}` : ""}`;
}

/**
 * What a session said about assessments and deadlines before graded activities had cards of
 * their own. It still prints, beside the session, until the teacher removes it.
 */
function EarlierNote({ row, onRemove }: { row: ScheduleRow; onRemove: () => void }) {
  const assessments = (row.assessments ?? "").trim();
  const deadline = (row.deadline ?? "").trim();
  if (!assessments && !deadline) return null;
  return (
    <div role="note" className="rounded-md border border-[#f0d8a8] bg-[#fdf8ee] px-3 py-2 text-sm text-[#8a6116]">
      <p className="font-semibold">Earlier note</p>
      {assessments ? <p className="mt-1 whitespace-pre-line">Assessments: {assessments}</p> : null}
      {deadline ? <p className="mt-1">Deadline: {deadline}</p> : null}
      <p className="mt-1 text-xs">Written before graded activities had cards of their own. It still prints with this session until you remove it.</p>
      <button type="button" onClick={onRemove} className="mt-2 text-sm font-semibold text-[#a6292f] hover:underline">Remove note</button>
    </div>
  );
}

function GradedCard({ card, number, expanded, highlighted = false, onSwitchKind, onToggle, onChange, onRemove, outcomes, cloKey, assessmentTypes, aiPolicies, foundationYear = false, syllabusId, revision, onOpenHistory }: {
  foundationYear?: boolean;
  highlighted?: boolean;
  /** Makes the card a session. */
  onSwitchKind?: () => void;
  card: ScheduleRow;
  number: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (changes: Record<string, unknown>) => void;
  onRemove: () => void;
  outcomes: Array<Record<string, string> & { id: string }>;
  cloKey: CloKey;
  assessmentTypes: CatalogueEntry[];
  aiPolicies: CatalogueEntry[];
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
}) {
  const title = (card.name ?? "").trim() || (card.type ?? "").trim() || "Untitled graded activity";
  const week = (card.week ?? "").trim();
  const date = (card.date ?? "").trim();
  const weight = (card.weight ?? "").trim();
  const summary = [week ? `Week ${week}` : "No week set", date ? displayDate(date) : "", weight ? `${weight}%` : ""].filter(Boolean).join(" · ");
  const problem = week ? weekProblem(week) : "Give it a week: the week is what places it in the schedule.";
  return (
    <CollapsibleEntryCard
      id={`schedule-${card.id}`}
      expanded={expanded}
      highlighted={highlighted}
      onToggle={onToggle}
      toggleLabel={`${expanded ? "Collapse" : "Expand"} graded activity: ${title}`}
      title={title}
      summary={summary}
      leading={
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1">
          <span aria-label={`Graded activity ${number}`} className="inline-flex h-5 items-center justify-center rounded-full bg-[#f3e8f7] px-2 text-xs font-semibold text-[#6b2c86]">Graded</span>
          <span className="inline-flex h-5 min-w-7 items-center justify-center rounded-full bg-[#eef1f5] px-1.5 text-xs font-semibold tabular-nums text-[#344054]">{number}</span>
        </span>
      }
      actions={
        <button type="button" onClick={onRemove} className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove graded activity: ${title}`} title="Remove graded activity">
          <Trash2 size={17} />
        </button>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {onSwitchKind ? <CardKindSwitch kind="graded" title={title} onSwitch={onSwitchKind} /> : null}
        {foundationYear ? (
          <FoundationYearGradedFields card={card} number={number} outcomes={outcomes} onChange={onChange} onOpenHistory={onOpenHistory} />
        ) : <GradedActivityFields
          entry={card}
          index={number - 1}
          path={`schedule[${card.id}]`}
          name={`Graded activity ${number}`}
          outcomes={outcomes}
          cloKey={cloKey}
          assessmentTypes={assessmentTypes}
          aiPolicies={aiPolicies}
          timing="both"
          timingNote={problem ?? undefined}
          onChange={onChange}
          syllabusId={syllabusId}
          revision={revision}
          onOpenHistory={onOpenHistory}
        />}
        {problem && foundationYear ? <p role="alert" className="text-sm text-[#a6292f]">{problem}</p> : null}
      </div>
    </CollapsibleEntryCard>
  );
}

/**
 * At the top of an open card: whether it is a session or a graded activity, to switch it. The
 * week, date and title carry over; what only the other kind has waits on the card for a switch
 * back (services/scheduleCardKind).
 */
function CardKindSwitch({ kind, title, onSwitch }: { kind: CardKind; title: string; onSwitch: () => void }) {
  const choices: Array<[CardKind, string]> = [["session", "Session"], ["graded", "Graded activity"]];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div role="group" data-card-kind aria-label={`Kind of card: ${title}`} className="inline-flex rounded-md border border-[#b7bec8] bg-white p-0.5">
        {choices.map(([id, name]) => (
          <button
            key={id}
            type="button"
            aria-pressed={kind === id}
            onClick={kind === id ? undefined : onSwitch}
            className={`rounded px-2.5 py-1 text-xs font-semibold ${kind === id ? "bg-[#1f4e79] text-white" : "text-[#1f4e79] hover:bg-[#f2f7fb]"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <span className="text-xs text-[#667085]">Switching keeps the week, date and title.</span>
    </div>
  );
}

/** The box that scrolls the card: the editor's workspace on a computer, the page on a phone. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

function displayDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;
}

/**
 * A Foundation Year graded activity: the row of the form's assessment tables it fills, what it
 * is, the outcomes it measures (by number, as the form names them) and its weight.
 */
function FoundationYearGradedFields({ card, number, outcomes, onChange, onOpenHistory }: { card: ScheduleRow; number: number; outcomes: Array<Record<string, string> & { id: string }>; onChange: (changes: Record<string, unknown>) => void; onOpenHistory: (field: HistoryField) => void }) {
  const path = `schedule[${card.id}]`;
  const field = (key: string, label: string) => ({ field: { path: `${path}.${key}`, label: `Graded activity ${number} · ${label}` }, onOpenHistory });
  const numbers = Array.isArray((card as Record<string, unknown>).cloNumbers) ? ((card as Record<string, unknown>).cloNumbers as string[]) : [];
  const options = outcomes.map((outcome, index) => ({ value: String(index + 1), label: `CLO ${index + 1}: ${(outcome.clo ?? outcome.outcome ?? "").trim() || "Untitled outcome"}` }));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <FieldRow>
        <HistoryTextField label="Week" value={card.week ?? ""} onChange={(week) => onChange({ week })} type="number" min={1} step={1} size="counter" history={field("week", "Week")} />
        <div className={`grid content-start gap-1 ${fieldSizeClass.code}`}>
          <DateField label="Assessment date (optional)" value={card.date ?? ""} onChange={(date) => onChange({ date })} trailing={<FieldHistoryControl field={field("date", "Assessment date").field} onOpenSidebar={onOpenHistory} placement="center" />} />
        </div>
        <SyllabusField label="Row of the form" fieldKey={`${path}.component`} size="title" hint="Which line of the Foundation Year form's assessment tables this activity fills: a continuous-assessment component, the final assessment, or a laboratory component.">
          <SelectMenu label={`Graded activity ${number} row of the form`} value={(card as Record<string, string>).component ?? ""} onChange={(component) => onChange({ component })} wrap placeholder="Choose the row it fills" options={FYS_COMPONENTS} />
        </SyllabusField>
        <HistoryTextField label="Name" value={card.name ?? ""} onChange={(name) => onChange({ name })} size="name" grow history={field("name", "Name")} />
        <HistoryTextField label="Weight (%)" value={card.weight ?? ""} onChange={(weight) => onChange({ weight })} type="number" min={0} max={100} step={1} size="counter" history={field("weight", "Weight")} />
      </FieldRow>
      <HistoryTextField label="Description" value={(card as Record<string, string>).description ?? ""} onChange={(description) => onChange({ description })} multiline minRows={2} history={field("description", "Description")} />
      <PloAlignmentField
        label="CLO(s) to be measured"
        pickerLabel={`Add a CLO graded activity ${number} measures`}
        emptyText="No course outcomes selected yet."
        addText="Add CLO measured"
        value={numbers.map((value) => options.find((option) => option.value === value)?.label ?? "").filter(Boolean).join("\n")}
        onChange={(next) => onChange({ cloNumbers: next.split("\n").filter(Boolean).map((label) => options.find((option) => option.label === label)?.value).filter((value): value is string => Boolean(value)) })}
        options={options.map((option) => ({ value: option.label, label: option.label }))}
      />
      {(card as Record<string, string>).earlierClos ? <p className="text-sm text-[#475467]">Before the conversion this row said: CLO(s) {(card as Record<string, string>).earlierClos}</p> : null}
    </div>
  );
}

/** "2 h" on a session card, so the hours the document adds up show without opening it. */
function lengthLabel(row: Record<string, unknown>): string {
  const hours = sessionHours(row);
  return hours === null ? "No length set" : `${hours} h`;
}
