import { ArrowDown, ArrowUp, Columns3, RotateCcw } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";

import {
  DEFAULT_LAYOUT,
  moveColumn,
  toggleColumn,
  STUDENT_COLUMNS,
  type ColumnLayout,
} from "@/services/studentColumns";

/**
 * Which columns the table shows, and in what order.
 *
 * A checkbox adds or removes one; the arrows move it a place at a time. A column the row
 * cannot be read without — the id, and whether the portal still returns them — has no
 * checkbox, because hiding it would leave a table nobody could act on.
 */
export function ColumnMenu({
  layout,
  onChange,
}: {
  layout: ColumnLayout;
  onChange: (layout: ColumnLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const ordered = layout.order
    .map((id) => STUDENT_COLUMNS.find((column) => column.id === id))
    .filter((column): column is (typeof STUDENT_COLUMNS)[number] => Boolean(column));
  const shown = ordered.filter((column) => !layout.hidden.includes(column.id)).length;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Columns3 size={15} aria-hidden="true" /> Columns
          <span className="tabular-nums text-xs font-normal text-[#98a2b3]">{shown}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[100] w-72 rounded-md border border-[#d9dee7] bg-white p-2 shadow-lg"
        >
          <ul className="max-h-80 overflow-y-auto">
            {ordered.map((column, index) => {
              const visible = !layout.hidden.includes(column.id);
              return (
                <li key={column.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[#f8fafc]">
                  <input
                    type="checkbox"
                    id={`column-${column.id}`}
                    checked={visible}
                    disabled={column.required}
                    onChange={() => onChange(toggleColumn(layout, column.id))}
                  />
                  <label
                    htmlFor={`column-${column.id}`}
                    className={`flex-1 text-sm ${column.required ? "text-[#98a2b3]" : "text-[#344054]"}`}
                  >
                    {column.displayName}
                    {column.required ? <span className="ml-1 text-xs">(always shown)</span> : null}
                  </label>
                  <button
                    type="button"
                    aria-label={`Move ${column.displayName} left`}
                    disabled={index === 0}
                    onClick={() => onChange(moveColumn(layout, column.id, -1))}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79] disabled:opacity-30"
                  >
                    <ArrowUp size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${column.displayName} right`}
                    disabled={index === ordered.length - 1}
                    onClick={() => onChange(moveColumn(layout, column.id, 1))}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79] disabled:opacity-30"
                  >
                    <ArrowDown size={13} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => onChange(DEFAULT_LAYOUT)}
            className="mt-1 inline-flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-[#667085] hover:bg-[#f2f7fb]"
          >
            <RotateCcw size={13} aria-hidden="true" /> Reset to the default arrangement
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
