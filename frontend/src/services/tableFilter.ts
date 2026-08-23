/**
 * Typed column filters: the model the Aralytics call-reports table uses, ported here.
 *
 * A column declares what kind of value it holds — text, number, date, one option, or
 * several — and that kind decides which operators it offers and how a filter is tested.
 * A filter is `{ columnId, type, operator, values }`, so "Year is any of FY, L1" and
 * "First seen is between two dates" are the same shape and can be shown the same way.
 *
 * The operator tables carry the relationships between operators, which is what lets the
 * UI behave sensibly: `negation` is what a chip toggles to when you invert it, and
 * `singularOf` / `pluralOf` are what an operator becomes when the number of chosen values
 * crosses one — pick a second year level and "is" becomes "is any of" on its own.
 *
 * No dependency on a table library or a date library: the handful of day comparisons the
 * date operators need are at the bottom of this file.
 */

export type ColumnDataType = "text" | "number" | "date" | "option" | "multiOption";

/** Whether an operator takes one value or a pair. */
export type OperatorTarget = "single" | "multiple";

export type OperatorDetail = {
  target: OperatorTarget;
  /** The operator to move to when a second value is chosen. */
  singularOf?: string;
  /** The operator to fall back to when only one value is left. */
  pluralOf?: string;
  /** What inverting this operator gives, and what it was inverted from. */
  negation?: string;
  negationOf?: string;
};

type OperatorTable = Record<string, OperatorDetail>;

export const optionOperators: OperatorTable = {
  is: { target: "single", singularOf: "is any of", negation: "is not" },
  "is not": { target: "single", singularOf: "is none of", negationOf: "is" },
  "is any of": { target: "multiple", pluralOf: "is", negation: "is none of" },
  "is none of": { target: "multiple", pluralOf: "is not", negationOf: "is any of" },
};

export const multiOptionOperators: OperatorTable = {
  include: { target: "single", singularOf: "include any of", negation: "exclude" },
  exclude: { target: "single", singularOf: "exclude if any of", negationOf: "include" },
  "include any of": { target: "multiple", pluralOf: "include", negation: "exclude if all" },
  "exclude if all": { target: "multiple", pluralOf: "exclude", negationOf: "include any of" },
  "include all of": { target: "multiple", pluralOf: "include", negation: "exclude if any of" },
  "exclude if any of": { target: "multiple", pluralOf: "exclude", negationOf: "include all of" },
};

export const dateOperators: OperatorTable = {
  is: { target: "single", singularOf: "is between", negation: "is not" },
  "is not": { target: "single", singularOf: "is not between", negationOf: "is" },
  "is before": { target: "single", singularOf: "is between", negation: "is on or after" },
  "is on or after": { target: "single", singularOf: "is between", negationOf: "is before" },
  "is after": { target: "single", singularOf: "is between", negation: "is on or before" },
  "is on or before": { target: "single", singularOf: "is between", negationOf: "is after" },
  "is between": { target: "multiple", pluralOf: "is", negation: "is not between" },
  "is not between": { target: "multiple", pluralOf: "is not", negationOf: "is between" },
};

export const textOperators: OperatorTable = {
  contains: { target: "single", negation: "does not contain" },
  "does not contain": { target: "single", negationOf: "contains" },
};

export const numberOperators: OperatorTable = {
  is: { target: "single", singularOf: "is between", negation: "is not" },
  "is not": { target: "single", singularOf: "is not between", negationOf: "is" },
  "is greater than": { target: "single", negation: "is less than or equal to" },
  "is greater than or equal to": { target: "single", negation: "is less than" },
  "is less than": { target: "single", negation: "is greater than or equal to" },
  "is less than or equal to": { target: "single", negation: "is greater than" },
  "is between": { target: "multiple", pluralOf: "is", negation: "is not between" },
  "is not between": { target: "multiple", pluralOf: "is not", negationOf: "is between" },
};

export const OPERATORS: Record<ColumnDataType, OperatorTable> = {
  text: textOperators,
  number: numberOperators,
  date: dateOperators,
  option: optionOperators,
  multiOption: multiOptionOperators,
};

export const DEFAULT_OPERATORS: Record<ColumnDataType, Record<OperatorTarget, string>> = {
  text: { single: "contains", multiple: "contains" },
  number: { single: "is", multiple: "is between" },
  date: { single: "is", multiple: "is between" },
  option: { single: "is", multiple: "is any of" },
  multiOption: { single: "include", multiple: "include any of" },
};

export type ColumnOption = { value: string; label: string };

/** One filter a coordinator has applied. Values are strings; dates are ISO days. */
export type FilterModel = {
  columnId: string;
  type: ColumnDataType;
  operator: string;
  values: string[];
};

/** What a column is, for filtering purposes. `accessor` reads it off a row. */
export type FilterColumn<TRow> = {
  id: string;
  displayName: string;
  type: ColumnDataType;
  accessor: (row: TRow) => unknown;
};

/**
 * Which operator a filter should hold now that its values have changed.
 *
 * Only a crossing matters: one value to several, or several back to one. Editing two
 * values into two other values leaves the operator alone.
 */
export function determineNewOperator(
  type: ColumnDataType,
  oldValues: string[],
  nextValues: string[],
  currentOperator: string,
): string {
  const before = oldValues.length;
  const after = nextValues.length;
  if (before === after || (before >= 2 && after >= 2) || (before <= 1 && after <= 1)) {
    return currentOperator;
  }
  const detail = OPERATORS[type][currentOperator];
  if (!detail) return currentOperator;
  if (before < after && after >= 2) return detail.singularOf ?? currentOperator;
  if (before > after && after <= 1) return detail.pluralOf ?? currentOperator;
  return currentOperator;
}

/** The operator a chip toggles to when inverted, or itself when it has no opposite. */
export function invertOperator(type: ColumnDataType, operator: string): string {
  const detail = OPERATORS[type][operator];
  return detail?.negation ?? detail?.negationOf ?? operator;
}

// ------------------------------------------------------------------ testing

function intersection<T>(left: T[], right: T[]): T[] {
  return left.filter((item) => right.includes(item));
}

export function optionFilterFn(value: string, filter: FilterModel): boolean {
  if (filter.values.length === 0) return true;
  if (!value) return false;
  const found = filter.values.some((candidate) => candidate.toLowerCase() === value.toLowerCase());
  switch (filter.operator) {
    case "is":
    case "is any of":
      return found;
    case "is not":
    case "is none of":
      return !found;
    default:
      return true;
  }
}

export function multiOptionFilterFn(values: string[], filter: FilterModel): boolean {
  if (filter.values.length === 0) return true;
  if (!values) return false;
  const shared = intersection(values, filter.values);
  switch (filter.operator) {
    case "include":
    case "include any of":
      return shared.length > 0;
    case "exclude":
      return shared.length === 0;
    case "exclude if any of":
      return !(shared.length > 0);
    case "include all of":
      return shared.length === filter.values.length;
    case "exclude if all":
      return !(shared.length === filter.values.length);
    default:
      return true;
  }
}

export function textFilterFn(value: string, filter: FilterModel): boolean {
  if (filter.values.length === 0) return true;
  const needle = (filter.values[0] ?? "").toLowerCase().trim();
  if (needle === "") return true;
  const found = (value ?? "").toLowerCase().trim().includes(needle);
  switch (filter.operator) {
    case "contains":
      return found;
    case "does not contain":
      return !found;
    default:
      return true;
  }
}

export function numberFilterFn(value: number, filter: FilterModel): boolean {
  if (filter.values.length === 0) return true;
  const first = Number(filter.values[0]);
  const second = Number(filter.values[1]);
  if (Number.isNaN(first)) return true;
  switch (filter.operator) {
    case "is":
      return value === first;
    case "is not":
      return value !== first;
    case "is greater than":
      return value > first;
    case "is greater than or equal to":
      return value >= first;
    case "is less than":
      return value < first;
    case "is less than or equal to":
      return value <= first;
    case "is between":
      return value >= Math.min(first, second) && value <= Math.max(first, second);
    case "is not between":
      return value < Math.min(first, second) || value > Math.max(first, second);
    default:
      return true;
  }
}

export function dateFilterFn(value: string, filter: FilterModel): boolean {
  if (filter.values.length === 0) return true;
  const subject = asDay(value);
  const first = asDay(filter.values[0]);
  if (subject === null || first === null) return false;
  const second = asDay(filter.values[1]);
  switch (filter.operator) {
    case "is":
      return subject === first;
    case "is not":
      return subject !== first;
    case "is before":
      return subject < first;
    case "is on or after":
      return subject >= first;
    case "is after":
      return subject > first;
    case "is on or before":
      return subject <= first;
    case "is between": {
      if (second === null) return true;
      return subject >= Math.min(first, second) && subject <= Math.max(first, second);
    }
    case "is not between": {
      if (second === null) return true;
      return subject < Math.min(first, second) || subject > Math.max(first, second);
    }
    default:
      return true;
  }
}

/**
 * A timestamp reduced to the day it falls on.
 *
 * Every date operator compares whole days — "is" means the same day, not the same
 * millisecond — so the comparison happens on a day number and the clock is discarded.
 */
function asDay(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / 86_400_000;
}

/** Test one row against one filter, choosing the test by the column's kind. */
export function passes<TRow>(row: TRow, column: FilterColumn<TRow>, filter: FilterModel): boolean {
  const value = column.accessor(row);
  switch (column.type) {
    case "option":
      return optionFilterFn(String(value ?? ""), filter);
    case "multiOption":
      return multiOptionFilterFn(Array.isArray(value) ? value.map(String) : [], filter);
    case "text":
      return textFilterFn(String(value ?? ""), filter);
    case "number":
      return numberFilterFn(Number(value), filter);
    case "date":
      return dateFilterFn(String(value ?? ""), filter);
    default:
      return true;
  }
}

/** Every filter must pass — the chips read as "and", the way the call-reports table does. */
export function applyFilters<TRow>(
  rows: TRow[],
  columns: FilterColumn<TRow>[],
  filters: FilterModel[],
): TRow[] {
  const active = filters.filter((filter) => filter.values.length > 0);
  if (active.length === 0) return rows;
  const byId = new Map(columns.map((column) => [column.id, column]));
  return rows.filter((row) =>
    active.every((filter) => {
      const column = byId.get(filter.columnId);
      return column ? passes(row, column, filter) : true;
    }),
  );
}
