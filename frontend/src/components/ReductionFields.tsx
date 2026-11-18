import { ArrowDown, Lock, PenLine, TriangleAlert } from "lucide-react";

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

/**
 * Who fills a part in: the teacher, or the Head of Department — said on the part in words, and
 * in its whole look. The teacher's part is blue, with boxes to type in; the Head of Department's
 * is amber, under a "nothing to fill in here" banner, with locked figures and no box at all
 * (18 Nov 2026: a quiet grey tag was not enough, teachers still took it for theirs).
 */
const OWNER = {
  you: {
    Icon: PenLine,
    words: "You fill this in",
    panel: "border-[#9cc0e4] bg-[#f5f9fd]",
    badge: "bg-[#1f4e79] text-white",
    tag: "border-[#9cc0e4] bg-white text-[#1f4e79]",
    list: "border-[#c9dcef] bg-white",
    rows: "divide-[#e4e7ec]",
  },
  hod: {
    Icon: Lock,
    words: "Filled in by the Head of Department",
    panel: "border-[#e5b454] bg-[#fdf6e3]",
    badge: "bg-[#7a5410] text-white",
    tag: "border-[#e5b454] bg-white text-[#7a5410]",
    list: "border-[#efd9a7] bg-[#fffcf5]",
    rows: "divide-[#f3e5c3]",
  },
};

/** One part of the step, at its top: its number, whose it is, and a jump down to it. */
export function PartCard({ owner, number, title, words }: { owner: keyof typeof OWNER; number: number; title: string; words: string }) {
  const whose = OWNER[owner];
  return (
    <button
      type="button"
      onClick={() => document.getElementById(`reductions-${owner}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className={`group flex flex-col gap-1.5 rounded-xl border-2 p-3 text-left transition-colors hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4e79] ${whose.panel}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${whose.badge}`}>
          {number}
        </span>
        <span className="text-sm font-semibold text-[#171717]">{title}</span>
      </span>
      <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${whose.tag}`}>
        <whose.Icon size={12} aria-hidden="true" /> {whose.words}
      </span>
      <span className="text-sm text-[#344054]">{words}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-0.5 text-xs font-semibold text-[#475467] group-hover:underline">
        <ArrowDown size={12} aria-hidden="true" /> Go to part {number}
      </span>
    </button>
  );
}

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
    <section
      id={owner ? `reductions-${owner}` : undefined}
      aria-label={title}
      data-owner={owner}
      className={whose ? `scroll-mt-4 rounded-xl border-2 p-3 sm:p-4 ${whose.panel}` : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[#171717]">
          {number ? (
            <span
              aria-hidden="true"
              className={`grid h-6 w-6 place-items-center rounded-full text-xs ${whose ? whose.badge : "bg-[#1f4e79] text-white"}`}
            >
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
      {owner === "hod" ? (
        // Not the teacher's to fill in, said before any row is read.
        <div role="note" className="mt-2.5 flex gap-2.5 rounded-lg border border-[#e5b454] bg-[#fef0c7] px-3 py-2.5">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-[#b54708]" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-[#7a2e0e]">Nothing to fill in here</p>
            <p className="mt-0.5 text-[#7a5410]">{about}</p>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs text-[#475467]">{about}</p>
      )}
      <ul className={`mt-2.5 divide-y rounded-lg border ${whose ? `${whose.list} ${whose.rows}` : "divide-[#e4e7ec] border-[#d0d5dd]"}`}>
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
            <li
              key={item.kind}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_15rem_4.5rem]"
            >
              {/* On a phone the kind takes the whole row; what is held and its hours share the next.
                  Wider, the boxes sit in one fixed column, so they line up row under row. */}
              <div className="col-span-2 min-w-0 sm:col-span-1">
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
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#344054]">
                      <Lock size={12} className="text-[#b08a3e]" aria-hidden="true" />
                      {heldWords({ ...item, ...value })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sm italic text-[#8a7a5a]">
                      <Lock size={12} className="text-[#c9b07a]" aria-hidden="true" />
                      Not set
                    </span>
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
                ) : owner === "hod" ? null : (
                  // On the Head of Department's own part, the panel already says who set it.
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
