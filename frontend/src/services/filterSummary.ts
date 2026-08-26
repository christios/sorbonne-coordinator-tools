/**
 * A registrar search, and how to say it in words.
 *
 * Kept out of the component file so the type and the wording can be shared without a
 * component import — and so fast refresh keeps working.
 */

import type { PortalField } from "@/services/scenRosters";

/** Portal codes, by field: {"YEARLEVEL_CODE": ["FY"], "MAJOR_CODE": ["MATH"]}. */
export type Filter = Record<string, string[]>;

/** "Year level FY, L1 · Major MATH" — for a heading or a button. */
export function describeFilter(filter: Filter, fields: PortalField[]): string {
  const labels = new Map(fields.map((field) => [field.key, field.label || field.key]));
  const parts = Object.entries(filter).map(
    ([key, values]) => `${labels.get(key) ?? key} ${values.join(", ")}`,
  );
  return parts.join(" · ") || "no filters yet";
}

/** One line of a filter, ready to read: the field, and the values it was fixed to. */
export type FilterLine = {
  /** The portal's own field code, which is what a registrar query actually carries. */
  key: string;
  /** What the portal calls it — "Year level" — or the code when it names it nothing. */
  field: string;
  values: { value: string; label: string }[];
  /** True when the schema does not describe this field, so only codes can be shown. */
  unknownField: boolean;
};

/**
 * A filter, broken out field by field.
 *
 * `describeFilter` runs it into one line for a caption; this keeps it apart so a screen
 * can lay it out and say which code sits behind each label. A view's filter is fixed when
 * the view is made and can never be edited, which makes reading it back the only way to
 * know what a population actually asked for — worth more than a truncated summary.
 */
export function filterLines(filter: Filter, fields: PortalField[]): FilterLine[] {
  const known = new Map(fields.map((field) => [field.key, field]));

  return Object.entries(filter)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => {
      const field = known.get(key);
      const options = new Map((field?.options ?? []).map((option) => [option.value, option.label]));
      return {
        key,
        field: field?.label || key,
        values: values.map((value) => ({ value, label: options.get(value) || value })),
        unknownField: !field,
      };
    })
    .sort((left, right) => left.field.localeCompare(right.field));
}
