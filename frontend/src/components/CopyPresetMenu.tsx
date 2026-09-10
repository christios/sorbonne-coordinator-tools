import { Check, ChevronLeft, ChevronRight, ClipboardCopy, GripVertical, Plus, Trash2, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import {
  loadPresets,
  newPresetId,
  movePicked,
  presetColumns,
  reorderPicked,
  savePresets,
  type CopyPreset,
  type CopyPresets,
} from "@/services/copyPresets";
import type { ColumnMeta } from "@/services/studentColumns";

/**
 * Sets of columns worth copying again, and the copying of them.
 *
 * Both halves live here on purpose: a coordinator making the same copy every week should
 * not have to rearrange the table to do it, and should not have to go anywhere else to
 * set one up. Clicking a preset copies straight to the clipboard — the tick is the whole
 * point, because a copy that worked looks exactly like one that silently did not.
 *
 * A preset names its columns outright, so it copies them whether or not the table is
 * showing them. That is what makes it worth having.
 *
 * Picking those columns happens in a dialog rather than inside the menu: the portal
 * offers upwards of forty, and choosing among them in a dropdown-width list means
 * scrolling a column of checkboxes through a letterbox.
 */
export function CopyPresetMenu<C extends ColumnMeta>({
  columns,
  onCopy,
  storageKey,
}: {
  /** Every column that exists, not only the ones on screen. */
  columns: C[];
  /** Put these columns on the clipboard. False when the browser refused. */
  onCopy: (columns: C[], withHeader: boolean) => Promise<boolean>;
  /** Where this table's presets live; each table keeps its own, as their columns differ. */
  storageKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<CopyPresets>({ presets: [], withHeader: false });
  const [editing, setEditing] = useState<CopyPreset | null>(null);
  const [state, setState] = useState<{ id: string; ok: boolean } | null>(null);

  // Read once on mount: they are this browser's, and a few hundred bytes.
  useEffect(() => setHeld(loadPresets(storageKey)), [storageKey]);

  useEffect(() => {
    if (!state) return;
    const settle = setTimeout(() => setState(null), 1_500);
    return () => clearTimeout(settle);
  }, [state]);

  const keep = (next: CopyPresets) => {
    setHeld(next);
    savePresets(next, storageKey);
  };

  const copy = async (preset: CopyPreset) => {
    const chosen = presetColumns(preset, columns);
    setState({ id: preset.id, ok: chosen.length > 0 && (await onCopy(chosen, held.withHeader))});
  };

  const save = (name: string, columnIds: string[]) => {
    const existing = editing && held.presets.some((preset) => preset.id === editing.id);
    keep({
      ...held,
      presets: existing
        ? held.presets.map((preset) =>
            preset.id === editing?.id ? { ...preset, name, columnIds } : preset,
          )
        : [...held.presets, { id: newPresetId(held.presets), name, columnIds }],
    });
    setEditing(null);
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            <ClipboardCopy size={15} aria-hidden="true" /> Copy
            {held.presets.length ? (
              <span className="tabular-nums text-xs font-normal text-[#98a2b3]">
                {held.presets.length}
              </span>
            ) : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            /*
             * Copying can take the focus — where the clipboard API is refused, the
             * fallback puts a textarea on the page and selects it — and a focus leaving
             * the menu would close it, which is to say the copy would dismiss its own
             * confirmation. Clicking away still closes it.
             */
            onFocusOutside={(event) => event.preventDefault()}
            className="z-[100] w-80 rounded-md border border-[#d9dee7] bg-white p-2 shadow-lg"
          >
            {held.presets.length ? (
              <ul className="max-h-72 overflow-y-auto">
                {held.presets.map((preset) => {
                  const chosen = presetColumns(preset, columns);
                  const feedback = state?.id === preset.id ? state : null;
                  return (
                    <li key={preset.id} className="flex items-center gap-1 rounded hover:bg-[#f8fafc]">
                      <button
                        type="button"
                        onClick={() => copy(preset)}
                        className="min-w-0 flex-1 px-2 py-1.5 text-left"
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium text-[#344054]">
                          {feedback ? (
                            feedback.ok ? (
                              <Check size={13} className="shrink-0 text-[#256237]" aria-hidden="true" />
                            ) : (
                              <X size={13} className="shrink-0 text-[#a6292f]" aria-hidden="true" />
                            )
                          ) : null}
                          <span className="truncate">{preset.name}</span>
                        </span>
                        <span className="block truncate text-xs text-[#98a2b3]">
                          {feedback
                            ? feedback.ok
                              ? "Copied"
                              : chosen.length === 0
                                ? "None of these columns exist any more"
                                : "This browser would not let us copy"
                            : chosen.map((column) => column.displayName).join(", ") ||
                              "None of these columns exist any more"}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit the ${preset.name} preset`}
                        onClick={() => {
                          setEditing(preset);
                          setOpen(false);
                        }}
                        className="rounded px-1.5 py-1 text-xs text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete the ${preset.name} preset`}
                        onClick={() =>
                          keep({ ...held, presets: held.presets.filter((other) => other.id !== preset.id) })
                        }
                        className="rounded p-1.5 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-2 py-3 text-sm text-[#667085]">
                A preset copies the same columns every time, whether or not the table is showing
                them. It copies the students you have ticked, or everything the table is showing
                when you have ticked none.
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setEditing({ id: "", name: "", columnIds: [] });
                setOpen(false);
              }}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
            >
              <Plus size={14} aria-hidden="true" /> New preset
            </button>

            <label className="mt-2 flex items-center gap-2 border-t border-[#eef1f5] px-1 pt-2 text-sm text-[#344054]">
              <input
                type="checkbox"
                checked={held.withHeader}
                onChange={() => keep({ ...held, withHeader: !held.withHeader })}
              />
              Include a header row
            </label>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <PresetDialog
        preset={editing}
        columns={columns}
        onSave={save}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

/**
 * Choosing the columns, with room to see them.
 *
 * The order matters and is not the table's: columns copy in the order they were ticked,
 * because that is the only order anyone has stated. So each pick carries its number, and
 * the chosen set is listed back in full — a preset whose columns come out in a surprising
 * order is one you find out about after pasting.
 */
function PresetDialog<C extends ColumnMeta>({
  preset,
  columns,
  onSave,
  onClose,
}: {
  preset: CopyPreset | null;
  columns: C[];
  onSave: (name: string, columnIds: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState("");

  // Reopening for a different preset must not show the last one's answers.
  useEffect(() => {
    setName(preset?.name ?? "");
    setPicked(preset?.columnIds ?? []);
    setSearch("");
    setDragging("");
    setOver("");
  }, [preset]);

  const needle = search.trim().toLowerCase();
  const listed = needle
    ? columns.filter((column) => column.displayName.toLowerCase().includes(needle))
    : columns;
  const known = new Map(columns.map((column) => [column.id, column]));
  const ready = Boolean(name.trim()) && picked.length > 0;

  return (
    <Modal
      open={Boolean(preset)}
      title={preset?.id ? `Edit ${preset.name}` : "New copy preset"}
      description="Clicking this preset copies these columns, in this order, for the students you have ticked — or for everything the table is showing when you have ticked none."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onSave(name.trim(), picked)}
            className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#b7bec8]"
          >
            {picked.length
              ? `Save ${picked.length} column${picked.length === 1 ? "" : "s"}`
              : "Pick some columns"}
          </button>
        </div>
      }
    >
      <label className="block">
        <span className="text-sm font-medium text-[#344054]">Name</span>
        <input
          aria-label="Preset name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="What is this copy for? — “Mail merge”, “Attendance register”"
          className="mt-1 w-full rounded border border-[#cbd5e1] px-2 py-1.5 text-sm"
        />
      </label>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-[#344054]">Columns, in the order they copy</span>
          {picked.length ? (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="text-xs text-[#667085] underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
        {picked.length ? (
          <ul
            className="mt-1 flex flex-wrap gap-1"
            // Dropping past the last chip means the end, which the chips themselves
            // cannot say — a drag beyond them is over this list and nothing else.
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain");
              if (id) setPicked((current) => reorderPicked(current, id, ""));
              setDragging("");
            }}
          >
            {picked.map((id, at) => {
              const label = known.get(id)?.displayName ?? id;
              const lifted = dragging === id;
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={(event) => {
                    setDragging(id);
                    event.dataTransfer.effectAllowed = "move";
                    // Firefox starts no drag at all unless something is set here.
                    event.dataTransfer.setData("text/plain", id);
                  }}
                  onDragEnd={() => setDragging("")}
                  onDragOver={(event) => {
                    if (!dragging || lifted) return;
                    // Without this the drop is refused and the cursor shows the "no" sign.
                    event.preventDefault();
                    setOver(id);
                  }}
                  onDragLeave={() => setOver((current) => (current === id ? "" : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOver("");
                    if (dragging && !lifted) setPicked((current) => reorderPicked(current, dragging, id));
                    setDragging("");
                  }}
                  className={`relative flex cursor-grab items-center gap-1 rounded border px-1.5 py-1 text-sm ${
                    lifted ? "border-[#cbd5e1] opacity-40" : "border-[#cfe0ee] bg-[#f2f7fb] text-[#1f4e79]"
                  }`}
                >
                  {/* Where it would land. */}
                  {over === id && dragging && !lifted ? (
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -left-0.5 w-0.5 bg-[#1f4e79]" />
                  ) : null}
                  <GripVertical size={12} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />
                  <span className="tabular-nums text-xs text-[#98a2b3]">{at + 1}</span>
                  {label}
                  {/* A drag needs a mouse; these do not. */}
                  <span className="ml-0.5 flex items-center">
                    <button
                      type="button"
                      aria-label={`Move ${label} earlier`}
                      disabled={at === 0}
                      onClick={() => setPicked((current) => movePicked(current, id, -1))}
                      className="rounded px-0.5 text-[#98a2b3] hover:text-[#1f4e79] disabled:opacity-30"
                    >
                      <ChevronLeft size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${label} later`}
                      disabled={at === picked.length - 1}
                      onClick={() => setPicked((current) => movePicked(current, id, 1))}
                      className="rounded px-0.5 text-[#98a2b3] hover:text-[#1f4e79] disabled:opacity-30"
                    >
                      <ChevronRight size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Take ${label} out`}
                      onClick={() => setPicked((current) => current.filter((kept) => kept !== id))}
                      className="rounded px-0.5 text-[#98a2b3] hover:text-[#a6292f]"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 min-h-5 text-sm text-[#98a2b3]">
            Nothing picked yet. Tick a column below; drag them to change the order.
          </p>
        )}
      </div>

      <input
        aria-label="Search columns"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search columns"
        className="mt-3 w-full rounded border border-[#cbd5e1] px-2 py-1.5 text-sm"
      />

      <ul className="mt-2 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        {listed.map((column) => {
          const at = picked.indexOf(column.id);
          return (
            <li key={column.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[#f8fafc]">
              <input
                type="checkbox"
                id={`preset-column-${column.id}`}
                checked={at >= 0}
                onChange={() =>
                  setPicked((current) =>
                    current.includes(column.id)
                      ? current.filter((id) => id !== column.id)
                      : [...current, column.id],
                  )
                }
              />
              <label
                htmlFor={`preset-column-${column.id}`}
                className="min-w-0 flex-1 truncate text-sm text-[#344054]"
              >
                {column.displayName}
              </label>
              {at >= 0 ? (
                <span className="shrink-0 tabular-nums text-xs text-[#98a2b3]">{at + 1}</span>
              ) : null}
            </li>
          );
        })}
        {listed.length === 0 ? (
          <li className="px-1 py-2 text-sm text-[#98a2b3]">No column matches that.</li>
        ) : null}
      </ul>
    </Modal>
  );
}
