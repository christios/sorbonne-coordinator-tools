import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export type SimpleColumn<T> = {
  key: string;
  label: string;
  /** What to sort and search by; the cell's text when there is no render. */
  value: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * A plain sortable, searchable table for a list that is not the student roster.
 *
 * The roster's table earns its windowing, dragging and column store with three thousand
 * rows and forty columns; a list of courses or teachers is a few hundred rows and a dozen
 * columns, and asks only to be sorted by a heading and narrowed by a search box.
 */
export function SimpleTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  searchLabel = "Search",
  empty = "Nothing here yet.",
  toolbar,
}: {
  columns: SimpleColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; ascending: boolean };
  searchLabel?: string;
  empty?: string;
  /** Anything to sit beside the search box: a term picker, a status toggle. */
  toolbar?: ReactNode;
}) {
  const [sort, setSort] = useState(initialSort ?? { key: columns[0]?.key ?? "", ascending: true });
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = needle
      ? rows.filter((row) => columns.some((column) => String(column.value(row)).toLowerCase().includes(needle)))
      : rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return kept;
    const sorted = [...kept].sort((left, right) => {
      const a = column.value(left);
      const b = column.value(right);
      const order = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
      return sort.ascending ? order : -order;
    });
    return sorted;
  }, [rows, columns, sort, query]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {toolbar}
        <label className="relative ml-auto block w-full sm:w-64">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label={searchLabel}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLabel}
            className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <span className="text-xs text-[#98a2b3]">
          {visible.length === rows.length ? `${rows.length} rows` : `${visible.length} of ${rows.length} rows`}
        </span>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#f8fafc] text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              {columns.map((column) => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={`whitespace-nowrap px-3 py-2.5 font-semibold ${column.align === "right" ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      aria-label={`Sort by ${column.label}`}
                      onClick={() => setSort({ key: column.key, ascending: active ? !sort.ascending : true })}
                      className={`inline-flex items-center gap-1 ${active ? "text-[#1f4e79]" : ""}`}
                    >
                      {column.label}
                      {active ? (
                        sort.ascending ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-[#667085]">
                  {empty}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={rowKey(row)} className="border-t border-[#eef1f5]">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 align-top ${column.align === "right" ? "text-right tabular-nums" : ""}`}
                    >
                      {column.render ? column.render(row) : String(column.value(row))}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
