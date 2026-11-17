import { Lock, PenLine } from "lucide-react";

import { type ReductionDraft } from "@/components/useReductionDraft";
import { type ReductionItem, type ReductionState, heldWords, hoursOf, stateWords } from "@/services/hourReductions";

const hours = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} h`;

const STATE_LOOK: Record<ReductionState, string> = {
  "": "",
  declared: "border-[#d99b1c] bg-[#fff8e6] text-[#7a5410]",
  validated: "border-[#2e7d55] bg-[#e7f4ec] text-[#1f5c3d]",
  set: "border-[#98a2b3] bg-[#f2f4f7] text-[#344054]",
};

export function StateTag({ state }: { state: ReductionState }) {
  if (!state) return null;
  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold ${STATE_LOOK[state]}`}>
      {stateWords(state)}
    </span>
  );
}

const field = "rounded-md border border-[#b7bec8] bg-white px-2 py-1.5 text-sm text-[#171717]";

/** One kind's control: a count, hours, a yes, committees, or one option. */
function Control({
  item,
  value,
  onChange,
}: {
  item: ReductionItem;
  value: ReductionDraft[string];
  onChange: (value: Partial<ReductionDraft[string]>) => void;
}) {
  const label = `${item.label}`;
  if (item.unit === "students" || item.unit === "hours") {
    const most = item.unit === "hours" ? (item.available ?? item.cap ?? undefined) : 100;
    return (
      <label className="inline-flex items-center gap-1.5 text-sm text-[#475467]">
        <input
          type="number"
          aria-label={label}
          min={0}
          max={most}
          step={item.unit === "students" ? 1 : 0.5}
          value={value.amount || ""}
          placeholder="0"
          onChange={(event) => onChange({ amount: Math.max(0, Number(event.target.value) || 0) })}
          className={`${field} w-20`}
        />
        {item.unit === "students" ? "students" : "h"}
      </label>
    );
  }
  if (item.unit === "yes") {
    return (
      <label className="inline-flex items-center gap-2 text-sm text-[#344054]">
        <input type="checkbox" aria-label={label} checked={Boolean(value.amount)} onChange={(event) => onChange({ amount: event.target.checked ? 1 : 0 })} />
        Yes
      </label>
    );
  }
  if (item.unit === "committees") {
    const chosen = value.detail.split(",").filter(Boolean);
    return (
      <span className="flex flex-wrap gap-3">
        {(item.options ?? []).map((option) => (
          <label key={option.key} className="inline-flex items-center gap-1.5 text-sm text-[#344054]">
            <input
              type="checkbox"
              aria-label={`${option.label} committee`}
              checked={chosen.includes(option.key)}
              onChange={(event) => {
                const next = event.target.checked ? [...chosen, option.key] : chosen.filter((key) => key !== option.key);
                const ordered = (item.options ?? []).map((entry) => entry.key).filter((key) => next.includes(key));
                onChange({ detail: ordered.join(","), amount: ordered.length });
              }}
            />
            {option.label}
          </label>
        ))}
      </span>
    );
  }
  return (
    <select
      aria-label={label}
      value={value.detail}
      onChange={(event) => onChange({ detail: event.target.value, amount: event.target.value ? 1 : 0 })}
      className={`${field} max-w-full`}
    >
      <option value="">None</option>
      {(item.options ?? []).map((option) => (
        <option key={option.key} value={option.key}>
          {option.label} · {option.hours} h
        </option>
      ))}
    </select>
  );
}

/** Who fills a part in: the teacher, or the Head of Department — said on the part, in words and looks. */
const OWNER = {
  you: { Icon: PenLine, words: "You fill this in", tag: "border-[#9cc0e4] bg-[#eef4fa] text-[#1f4e79]", list: "border-[#d0d5dd] bg-white" },
  hod: { Icon: Lock, words: "Filled in by the Head of Department", tag: "border-[#d0d5dd] bg-[#f2f4f7] text-[#475467]", list: "border-dashed border-[#c8d0db] bg-[#f8fafc]" },
};

/**
 * A group of kinds, one row each: what it is and its rule, what is held, its hours, and where
 * it stands. `editable` says which rows take a figure; the rest are read. `owner`, on the
 * teacher's step, says whose part it is (17 Nov 2026: teachers took the Head of Department's
 * part for one of their own to fill in).
 */
export function ReductionFields({
  title,
  about,
  items,
  draft,
  onChange,
  editable,
  withValidation = false,
  owner,
  number,
}: {
  title: string;
  about: string;
  items: ReductionItem[];
  draft: ReductionDraft;
  onChange: (kind: string, value: Partial<ReductionDraft[string]>) => void;
  editable: (item: ReductionItem) => boolean;
  /** The Head of Department's tick: checked with SAFIR. */
  withValidation?: boolean;
  /** Whose part this is, tagged so at its head: the teacher's, or the Head of Department's. */
  owner?: keyof typeof OWNER;
  /** Its number among the step's parts. */
  number?: number;
}) {
  const whose = owner ? OWNER[owner] : null;
  return (
    <section aria-label={title} data-owner={owner}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[#171717]">
          {number ? (
            <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-[#1f4e79] text-[11px] text-white">
              {number}
            </span>
          ) : null}
          {title}
        </h3>
        {whose ? (
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${whose.tag}`}>
            <whose.Icon size={12} aria-hidden="true" /> {whose.words}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[#475467]">{about}</p>
      <ul className={`mt-2 divide-y divide-[#e4e7ec] rounded-lg border ${whose ? whose.list : "border-[#d0d5dd]"}`}>
        {items.map((item) => {
          const value = draft[item.kind] ?? { amount: 0, detail: "", validated: false };
          const given = hoursOf(item, value.amount, value.detail);
          const changed = value.amount !== item.amount || value.detail !== item.detail;
          // A teacher's change to a validated figure is theirs again until it is checked.
          const state: ReductionState = !given
            ? ""
            : withValidation && item.group === "safir"
              ? value.validated
                ? "validated"
                : "declared"
              : changed && item.group === "safir"
                ? "declared"
                : item.state || (item.group === "safir" ? "declared" : "set");
          return (
            <li key={item.kind} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_4.5rem] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#171717]">{item.label}</p>
                <p className="text-xs text-[#475467]">{item.rule}</p>
                {item.kind === "irg" && item.available !== undefined && editable(item) ? (
                  <p className="text-xs text-[#475467]">This year: {hours(item.available)} left of the project&rsquo;s hours.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editable(item) ? (
                  <Control item={item} value={value} onChange={(next) => onChange(item.kind, next)} />
                ) : owner === "hod" ? (
                  // Read only, and drawn so: no box to type in, "Not set" where nothing is.
                  heldWords({ ...item, ...value }) ? (
                    <span className="inline-flex items-center gap-1 text-sm text-[#344054]">
                      <Lock size={12} className="text-[#98a2b3]" aria-hidden="true" />
                      {heldWords({ ...item, ...value })}
                    </span>
                  ) : (
                    <span className="text-sm italic text-[#98a2b3]">Not set</span>
                  )
                ) : (
                  <span className="text-sm text-[#344054]">{heldWords({ ...item, ...value }) || "—"}</span>
                )}
                {withValidation && item.group === "safir" && given ? (
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1f5c3d]">
                    <input
                      type="checkbox"
                      aria-label={`${item.label} validated with SAFIR`}
                      checked={value.validated}
                      onChange={(event) => onChange(item.kind, { validated: event.target.checked })}
                    />
                    Validated with SAFIR
                  </label>
                ) : (
                  <StateTag state={state} />
                )}
              </div>
              <p className={`text-right text-sm font-semibold tabular-nums ${given ? "text-[#171717]" : "text-[#98a2b3]"}`}>
                {hours(given)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The year in two numbers: reductions, and teaching still owed out of the service. */
export function ReductionTotals({ total, owed, service }: { total: number; owed: number; service: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-[#1f4e79] bg-[#f2f7fb] px-4 py-3">
      <p className="text-sm text-[#344054]">
        Reductions <b className="text-base tabular-nums text-[#171717]">{hours(total)}</b>
      </p>
      <p className="text-sm text-[#344054]">
        Teaching owed <b className="text-base tabular-nums text-[#171717]">{hours(owed)}</b> of {service} h
      </p>
      {total > service ? <p className="text-xs text-[#7a5410]">More than the year&rsquo;s service: nothing is left to teach.</p> : null}
    </div>
  );
}
