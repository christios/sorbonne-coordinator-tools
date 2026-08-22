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
