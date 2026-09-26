import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { fetchPortalCourses, fetchTermLinks } from "@/services/portalLists";
import { rowsHeld } from "@/services/rosterStore";
import { fetchSchema, type PortalField, type RosterRow } from "@/services/scenRosters";

/*
 * What a cohort expects of its students — the majors, the portal terms it spans, a year
 * level — and the pickers they are chosen with, shared by the New cohort dialog and the
 * cohort's settings.
 *
 * All three are required. The Cohorts page finds the students who belong to a cohort and
 * are not in it by these, and a cohort that said none of them was never offered any: L2-S1
 * went a month without sixteen of its students that way. The server refuses a cohort
 * without them too; this says so before anybody presses Save.
 */

type Option = { value: string; label: string };

/** The codes the department has always dealt in, for a browser that has read nothing yet. */
const KNOWN: Record<string, Option[]> = {
  MAJOR_CODE: [
    { value: "MATH", label: "Applied Mathematics and Physics" },
    { value: "PHYS", label: "Physics" },
  ],
  YEARLEVEL_CODE: [
    { value: "FY", label: "Foundation Year" },
    { value: "L1", label: "L1" },
    { value: "L2", label: "L2" },
    { value: "L3", label: "L3" },
  ],
  TERM_CODE: [],
};

/**
 * Every code a field is known to take, from every source this browser has: the portal's
 * own table when the extension has read it, the values on the rows the pulls hold, the
 * portal terms other pages know, and the codes the department has always used. Each once,
 * the portal's label where there is one.
 */
function choicesFor(field: string, sources: { schema: PortalField[]; rows: RosterRow[]; extra: Option[] }): Option[] {
  const out = new Map<string, string>();
  const add = (value: string, label = "") => {
    const code = value.trim();
    if (!code) return;
    if (!out.has(code) || (label && out.get(code) === code)) out.set(code, label || out.get(code) || code);
  };
  for (const option of sources.schema.find((held) => held.key.toUpperCase() === field)?.options ?? []) add(option.value, option.label);
  for (const option of sources.extra) add(option.value, option.label);
  for (const option of KNOWN[field] ?? []) add(option.value, option.label);
  // What the pulls carry: the code when they have it, else the description, which the
  // rules match by label anyway.
  const described = field.replace(/_CODE$/, "_DESC");
  for (const row of sources.rows) {
    const code = String(row[field] ?? "").trim();
    const desc = String(row[described] ?? row[`${field}_DESC`] ?? "").trim();
    if (code) add(code, desc);
    else if (desc) add(desc);
  }
  return [...out.entries()]
    .map(([value, label]) => ({ value, label: label === value ? value : `${label} (${value})` }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * Portal codes, chosen from a list — never typed into the list itself. What is kept is
 * the code, never the label. A code nobody has listed yet can be added underneath, and
 * from then on it is one of the choices.
 */
export function CodesField({
  label,
  hint,
  values,
  options,
  placeholder,
  noun,
  single = false,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  options: SelectOption[];
  placeholder: string;
  noun: string;
  single?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [other, setOther] = useState("");
  const [adding, setAdding] = useState(false);
  // A value the list does not carry — saved on a day it was not known — is still offered,
  // so a saved cohort never shows a blank where its own expectation should be.
  const offered: SelectOption[] = [...options];
  for (const value of values) {
    if (!offered.some((option) => option.value === value)) offered.push({ value, label: value });
  }
  const add = () => {
    const code = other.trim().toUpperCase();
    if (!code) return;
    onChange(single ? [code] : values.includes(code) ? values : [...values, code]);
    setOther("");
    setAdding(false);
  };
  return (
    <div className="block text-sm font-semibold text-[#344054]">
      {label}
      {hint ? <span className="block text-xs font-normal text-[#98a2b3]">{hint}</span> : null}
      <div className="mt-1.5">
        <SelectMenu
          label={label}
          value={single ? (values[0] ?? "") : values.join("\n")}
          multiple={!single}
          itemNoun={noun}
          placeholder={single ? "None" : `Choose ${noun}s…`}
          searchable={offered.length > 12}
          onChange={(next) => onChange(single ? (next ? [next] : []) : next.split("\n").filter(Boolean))}
          options={single ? [{ value: "", label: "None" }, ...offered] : offered}
        />
      </div>
      {adding ? (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            aria-label={`Add a ${noun} code`}
            autoFocus
            value={other}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
              if (event.key === "Escape") setAdding(false);
            }}
            placeholder={placeholder}
            className="block w-40 rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-normal"
          />
          <button type="button" onClick={add} disabled={!other.trim()} className="text-xs font-semibold text-[#1f4e79] disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs font-semibold text-[#667085]">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-normal text-[#667085] hover:text-[#1f4e79]"
        >
          <Plus size={12} aria-hidden="true" /> A {noun} code not listed
        </button>
      )}
    </div>
  );
}


/** Which of the three a cohort has not said yet, in the words the form uses. */
export function missingExpectations(input: { majors: string[]; terms: string[]; yearLevel: string }): string[] {
  return [
    input.majors.some((code) => code.trim()) ? "" : "majors",
    input.terms.some((code) => code.trim()) ? "" : "portal term",
    input.yearLevel.trim() ? "" : "year level",
  ].filter(Boolean);
}

/** The codes each field can take, from every source this browser has. */
export function useExpectationOptions(enabled: boolean) {
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled, staleTime: 60_000 });
  const held = useQuery({ queryKey: ["roster-rows-held"], queryFn: rowsHeld, enabled, staleTime: 60_000 });
  const portalTerms = useQuery({ queryKey: ["portal", "courses", ""], queryFn: () => fetchPortalCourses("", ""), enabled, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled, retry: false });
  const sources = { schema: schema.data?.fields ?? [], rows: held.data ?? [], extra: [] as Option[] };
  // Terms come from more places than a table: the term the extension is set to, the terms
  // the Courses list holds, and the ones the semesters are linked to.
  const current = schema.data?.term;
  const termExtra: Option[] = [
    ...(current ? [{ value: current.code, label: current.label || current.code }] : []),
    ...(portalTerms.data?.terms ?? []).map((code) => ({ value: code, label: code })),
    ...Object.values(links.data ?? {}).map((code) => ({ value: code, label: code })),
  ];
  return {
    majorOptions: choicesFor("MAJOR_CODE", sources),
    termOptions: choicesFor("TERM_CODE", { ...sources, extra: termExtra }),
    yearOptions: choicesFor("YEARLEVEL_CODE", sources),
  };
}

/** The three expectations, each required, as the cohort's settings and New cohort show them. */
export function CohortExpectationsFields({
  majors,
  terms,
  yearLevel,
  onMajors,
  onTerms,
  onYearLevel,
  enabled,
}: {
  majors: string[];
  terms: string[];
  yearLevel: string;
  onMajors: (next: string[]) => void;
  onTerms: (next: string[]) => void;
  onYearLevel: (next: string) => void;
  enabled: boolean;
}) {
  const { majorOptions, termOptions, yearOptions } = useExpectationOptions(enabled);
  return (
    <>
      <CodesField
        label="Majors the cohort expects *"
        hint="MAJOR_CODE, as the portal filters by it. More than one when the cohort spans them."
        values={majors}
        options={majorOptions}
        placeholder="MATH, PHYS"
        noun="major"
        onChange={onMajors}
      />
      <CodesField
        label="Portal terms the cohort spans *"
        hint="TERM_CODE — both semesters of the year, usually."
        values={terms}
        options={termOptions}
        placeholder="262710, 262720"
        noun="term"
        onChange={onTerms}
      />
      <CodesField
        label="Year level the cohort expects *"
        hint="YEARLEVEL_CODE."
        values={yearLevel ? [yearLevel] : []}
        options={yearOptions}
        placeholder="L1"
        noun="year level"
        single
        onChange={(next) => onYearLevel(next[0] ?? "")}
      />
    </>
  );
}
