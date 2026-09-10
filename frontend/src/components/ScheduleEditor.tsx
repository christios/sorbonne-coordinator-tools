import { AddEntryButton } from "@/components/AddEntryButton";
import { ArrowDownUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CollapsibleEntryCard } from "@/components/CollapsibleEntryCard";
import { SelectMenu } from "@/components/SelectMenu";
import { HistoryTextField } from "@/components/HistoryTextField";
import { type HistoryField } from "@/components/FieldHistory";

type ScheduleRow = Record<string, string> & { id: string };
type ScheduleField = {
  key: "week" | "deadline" | "topic" | "details" | "preClass" | "assessments";
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


type Props = {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
};

const fields: ScheduleField[] = [
  { key: "week", label: "Week" },
  { key: "deadline", label: "Deadline" },
  { key: "topic", label: "Topic" },
  { key: "details", label: "Session details", multiline: true },
  { key: "preClass", label: "Pre-class learning activities", multiline: true },
  { key: "assessments", label: "Assessments", multiline: true },
] as const;

export function ScheduleEditor({
  rows,
  onChange,
  onOpenHistory,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    rows.filter((row) => !row.topic?.trim()).map((row) => row.id),
  );
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
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
  const sessionNumbers = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of rows) {
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
  const addRow = () => {
    const id = crypto.randomUUID();
    onChange([
      ...rows,
      { id, sessionType: DEFAULT_SESSION_TYPE, week: "", deadline: "", topic: "", details: "", preClass: "", assessments: "" },
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
      <h4 className="mb-3 text-sm font-semibold text-[#344054]">Sessions</h4>
      {rows.length ? (
        <>
        <div className="grid gap-3">
          {rows.map((row, index) => {
            const isExpanded = expandedIds.includes(row.id);
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
                onToggle={() => toggleExpanded(row.id)}
                toggleLabel={`${isExpanded ? "Collapse" : "Expand"} topic: ${topicLabel(row)} (position ${index + 1})`}
                title={topicLabel(row)}
                summary={row.week ? `Week ${row.week}` : "No week set"}
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
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#eef1f5] px-1.5 text-xs font-semibold text-[#344054]">
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
                      className="absolute right-0 top-full z-[90] isolate mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 opacity-100 shadow-lg"
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
                            <span className="text-[#667085]">
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
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-1 text-sm font-medium text-[#344054]">
                    Session type
                    <SelectMenu
                      label={`Session ${sessionNumbers.get(row.id) ?? index + 1} type`}
                      value={row.sessionType || DEFAULT_SESSION_TYPE}
                      onChange={(next) => updateRow(row.id, "sessionType", next)}
                      options={SESSION_TYPES.map((item) => ({ value: item.value, label: item.label }))}
                    />
                  </label>
                  {fields.map((field) => {
                    const value = row[field.key] ?? "";
                    const historyField = {
                      path: `schedule[${row.id}].${field.key}`,
                      label: `Course schedule · ${field.label}`,
                    };
                    if (field.key === "week") {
                      const problem = weekProblem(value);
                      return (
                        <div key={field.key}>
                          <HistoryTextField
                            label={field.label}
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
                    if (field.key === "deadline") {
                      const suggestion = deadlineForWeek(row.week ?? "");
                      return (
                        <div key={field.key}>
                          <HistoryTextField
                            label={field.label}
                            value={value}
                            onChange={(next) => updateRow(row.id, field.key, next)}
                            history={{ field: historyField, onOpenHistory }}
                          />
                          {!value.trim() && suggestion ? (
                            <button
                              type="button"
                              onClick={() => updateRow(row.id, field.key, suggestion)}
                              className="mt-1 text-left text-sm font-semibold text-[#1f4e79] hover:underline"
                            >
                              Use &ldquo;{suggestion}&rdquo;
                            </button>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <HistoryTextField
                        key={field.key}
                        label={field.label}
                        value={value}
                        onChange={(next) => updateRow(row.id, field.key, next)}
                        multiline={field.multiline}
                        minRows={3}
                        className={field.multiline ? "lg:col-span-2" : ""}
                        history={{ field: historyField, onOpenHistory }}
                      />
                    );
                  })}
                </div>
              </CollapsibleEntryCard>
            );
          })}
        </div>
        <AddEntryButton onClick={addRow} label="Add session" ariaLabel="Add session at end" />
        </>
      ) : (
        <>
        <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">
          No sessions added yet.
        </p>
        <AddEntryButton onClick={addRow} label="Add session" />
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

