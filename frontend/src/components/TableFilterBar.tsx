import { FunnelPlus, FunnelX, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";

import { DateField } from "@/components/DateField";
import { SelectMenu } from "@/components/SelectMenu";
import {
  DEFAULT_OPERATORS,
  OPERATORS,
  determineNewOperator,
  type ColumnOption,
  type FilterModel,
} from "@/services/tableFilter";
import type { ColumnMeta } from "@/services/studentColumns";

/**
 * Column filters as a row of chips, after the Aralytics call-reports table.
 *
 * Each chip reads as a sentence — subject, operator, value — and each of the three parts
 * is its own control, so changing "is" to "is not" does not mean rebuilding the filter.
 * The operators on offer come from the column's kind, and the operator moves between its
 * singular and plural form on its own as values are added or removed.
 */
export function TableFilterBar<C extends ColumnMeta>({
  columns,
  filters,
  optionsFor,
  onChange,
}: {
  columns: C[];
  filters: FilterModel[];
  optionsFor: (column: C) => ColumnOption[];
  onChange: (filters: FilterModel[]) => void;
}) {
  const used = new Set(filters.map((filter) => filter.columnId));
  const spare = columns.filter((column) => !used.has(column.id));

  const replace = (columnId: string, next: Partial<FilterModel>) =>
    onChange(
      filters.map((filter) => (filter.columnId === columnId ? { ...filter, ...next } : filter)),
    );

  const add = (column: C) =>
    onChange([
      ...filters,
      {
        columnId: column.id,
        type: column.type,
        operator: DEFAULT_OPERATORS[column.type].single,
        values: [],
      },
    ]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => {
        const column = columns.find((candidate) => candidate.id === filter.columnId);
        if (!column) return null;
        return (
          <FilterChip
            key={filter.columnId}
            column={column}
            filter={filter}
            options={optionsFor(column)}
            onOperator={(operator) => replace(filter.columnId, { operator })}
            onValues={(values) =>
              replace(filter.columnId, {
                values,
                operator: determineNewOperator(filter.type, filter.values, values, filter.operator),
              })
            }
            onRemove={() =>
              onChange(filters.filter((kept) => kept.columnId !== filter.columnId))
            }
          />
        );
      })}

      {spare.length ? (
        <AddFilter columns={spare} onAdd={add} hasFilters={filters.length > 0} />
      ) : null}

      {filters.length ? (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="Clear filters"
          title="Clear all filters"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#b7bec8] bg-white text-[#344054] hover:border-[#e5b7b9] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
        >
          <FunnelX size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function AddFilter<C extends ColumnMeta>({
  columns,
  onAdd,
  hasFilters,
}: {
  columns: C[];
  onAdd: (column: C) => void;
  hasFilters: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={hasFilters ? "Add filter" : "Filter"}
          title={hasFilters ? "Add a filter" : "Filter the table"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-[#b7bec8] text-[#344054] hover:bg-[#f8fafc]"
        >
          {/* The funnel with a plus, as a spreadsheet draws it: the shape says it without the word. */}
          <FunnelPlus size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[100] w-56 rounded-md border border-[#d9dee7] bg-white p-1 shadow-lg"
        >
          <ul>
            {columns.map((column) => (
              <li key={column.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(column);
                    setOpen(false);
                  }}
                  className="w-full rounded px-2.5 py-1.5 text-left text-sm text-[#344054] hover:bg-[#f2f7fb]"
                >
                  {column.displayName}
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterChip<C extends ColumnMeta>({
  column,
  filter,
  options,
  onOperator,
  onValues,
  onRemove,
}: {
  column: C;
  filter: FilterModel;
  options: ColumnOption[];
  onOperator: (operator: string) => void;
  onValues: (values: string[]) => void;
  onRemove: () => void;
}) {
  const operators = Object.keys(OPERATORS[filter.type]);

  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-md border border-[#cfe0ef] bg-white text-sm">
      <span className="flex items-center bg-[#f2f7fb] px-2.5 py-1.5 font-semibold text-[#1f4e79]">
        {column.displayName}
      </span>

      <span className="border-l border-[#cfe0ef]">
        <ChipMenu label={`${column.displayName} operator`} value={filter.operator}>
          {(close) =>
            operators.map((operator) => (
              <button
                key={operator}
                type="button"
                onClick={() => {
                  onOperator(operator);
                  close();
                }}
                className={`w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-[#f2f7fb] ${
                  operator === filter.operator ? "font-semibold text-[#1f4e79]" : "text-[#344054]"
                }`}
              >
                {operator}
              </button>
            ))
          }
        </ChipMenu>
      </span>

      <span className="flex items-center border-l border-[#cfe0ef] px-1.5">
        <ChipValue column={column} filter={filter} options={options} onValues={onValues} />
      </span>

      <button
        type="button"
        aria-label={`Remove the ${column.displayName} filter`}
        onClick={onRemove}
        className="flex items-center border-l border-[#cfe0ef] px-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

/** The middle of a chip: a label that opens a small menu under it. */
function ChipMenu({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="h-full px-2.5 py-1.5 text-[#667085] hover:bg-[#f8fafc]"
        >
          {value}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[100] w-56 rounded-md border border-[#d9dee7] bg-white p-1 shadow-lg"
        >
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The value end of a chip, which is a different control for each kind of column.
 *
 * `is between` wants two values and `is` wants one, so the number of inputs follows the
 * operator's target rather than the column.
 */
function ChipValue<C extends ColumnMeta>({
  column,
  filter,
  options,
  onValues,
}: {
  column: C;
  filter: FilterModel;
  options: ColumnOption[];
  onValues: (values: string[]) => void;
}) {
  const pair = OPERATORS[filter.type][filter.operator]?.target === "multiple";

  if (column.type === "option" || column.type === "multiOption") {
    // Sized to what it holds, within reason: the chip is there to be read.
    return (
      <span className="inline-block min-w-[11rem] max-w-[24rem] py-0.5">
        <SelectMenu
          label={`${column.displayName} value`}
          multiple
          itemNoun="value"
          searchable={options.length > 12}
          placeholder="Choose…"
          value={filter.values.join("\n")}
          onChange={(next) => onValues(next.split("\n").filter(Boolean))}
          options={options}
        />
      </span>
    );
  }

  if (column.type === "date") {
    return (
      <span className="flex items-center gap-1 py-0.5">
        <span className="w-36">
          <DateField
            label={`${column.displayName} date`}
            value={filter.values[0] ?? ""}
            onChange={(next) => onValues([next, ...(pair ? [filter.values[1] ?? ""] : [])].filter(Boolean))}
          />
        </span>
        {pair ? (
          <span className="w-36">
            <DateField
              label={`${column.displayName} second date`}
              value={filter.values[1] ?? ""}
              onChange={(next) => onValues([filter.values[0] ?? "", next].filter(Boolean))}
            />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 py-0.5">
      <input
        aria-label={`${column.displayName} value`}
        type={column.type === "number" ? "number" : "text"}
        value={filter.values[0] ?? ""}
        onChange={(event) =>
          onValues([event.target.value, ...(pair ? [filter.values[1] ?? ""] : [])].filter(Boolean))
        }
        placeholder="Type a value"
        className="w-36 rounded border border-[#cbd5e1] px-2 py-1 text-sm"
      />
      {pair ? (
        <input
          aria-label={`${column.displayName} second value`}
          type={column.type === "number" ? "number" : "text"}
          value={filter.values[1] ?? ""}
          onChange={(event) => onValues([filter.values[0] ?? "", event.target.value].filter(Boolean))}
          className="w-36 rounded border border-[#cbd5e1] px-2 py-1 text-sm"
        />
      ) : null}
    </span>
  );
}
