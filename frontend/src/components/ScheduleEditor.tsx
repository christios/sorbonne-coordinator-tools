import { AddEntryButton } from "@/components/AddEntryButton";
import { ArrowDownUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CollapsibleEntryCard } from "@/components/CollapsibleEntryCard";
import { DateField } from "@/components/DateField";
import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";
import { HistoryTextField } from "@/components/HistoryTextField";

type ScheduleRow = Record<string, string> & { id: string };
type ScheduleField = {
  key: "date" | "topic" | "details" | "preClass" | "assessments";
  label: string;
  type?: "date";
  multiline?: boolean;
};

type Props = {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
};

const fields: ScheduleField[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "topic", label: "Topic" },
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
      { id, date: "", topic: "", details: "", preClass: "", assessments: "" },
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
                summary={row.date || "No date set"}
                leading={
                  <span
                    aria-label={`Section ${index + 1}`}
                    className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#e8edf3] px-1.5 text-xs font-semibold text-[#1f4e79]"
                  >
                    {index + 1}
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
                  {fields.map((field) => {
                    const value = row[field.key] ?? "";
                    const historyField = {
                      path: `schedule[${row.id}].${field.key}`,
                      label: `Course schedule · ${field.label}`,
                    };
                    const historyControl = (
                      <FieldHistoryControl
                        syllabusId={syllabusId}
                        revision={revision}
                        field={historyField}
                        onOpenSidebar={onOpenHistory}
                        placement={field.multiline ? "top" : "center"}
                      />
                    );
                    if (field.type === "date") {
                      return (
                        <div key={field.key}>
                          <DateField
                            label={field.label}
                            value={dateInputValue(value)}
                            onChange={(next) =>
                              updateRow(row.id, field.key, next)
                            }
                            trailing={historyControl}
                          />
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
  return `${topicLabel(row)}${row.date ? ` · ${row.date}` : ""}`;
}

function dateInputValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}
