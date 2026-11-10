import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  BookOpen,
  Blocks,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Clock3,
  Contact,
  DoorOpen,
  GaugeCircle,
  GraduationCap,
  Info,
  ListChecks,
  ListTree,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

/**
 * The bubble, around any trigger: the ⓘ's own card, wherever the app explains something on
 * hover — a painted block of a teacher's week, a flag on the plan, where a dragged class would
 * land — so every hover reads the same.
 *
 * With a `title`, the bubble is a small card read top to bottom: a heading, what to do
 * (`TipDo`), what it changes (`TipPoint`s), and one real case of use (`TipUsage`). `wide`
 * is the ⓘ's card; a hover over the page itself is narrower. `open` holds it open or shut
 * from outside, for a bubble that follows a drag rather than the pointer.
 */
export function Tip({
  children,
  content,
  title,
  icon: Icon = Info,
  iconClassName = "text-[#1f4e79]",
  wide = Boolean(title),
  side,
  delay = 150,
  open,
  follow = false,
}: {
  /** The trigger: one element, which takes the hover and focus. */
  children: ReactNode;
  content: ReactNode;
  title?: ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  wide?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  /** How long the pointer rests before it opens, in milliseconds. */
  delay?: number;
  open?: boolean;
  /** Keep to a trigger that moves, as a dragged class's landing box does. */
  follow?: boolean;
}) {
  return (
    <Tooltip.Provider delayDuration={delay}>
      <Tooltip.Root open={open}>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            // A card opens beside its ⓘ, where it has the window's whole height to slide in;
            // above or below a header low on the page it had half of it, and scrolled.
            side={side ?? (wide ? "right" : "bottom")}
            align="start"
            sideOffset={4}
            collisionPadding={12}
            updatePositionStrategy={follow ? "always" : "optimized"}
            /*
             * Never taller than the room on the side it opens to: a long bubble flipped above
             * a button low on the page and ran off the top of the window. It scrolls inside
             * itself instead, and the pointer can move onto it to do so.
             */
            className={`z-[130] max-h-[var(--radix-tooltip-content-available-height)] overflow-y-auto overscroll-contain ${
              wide ? "w-[26rem] max-w-[calc(100vw-1.5rem)] px-3.5 py-3" : title ? "w-max max-w-xs px-3 py-2.5" : "max-w-xs px-3 py-2"
            } rounded-md border border-[#d9dee7] bg-white text-xs font-normal normal-case leading-5 tracking-normal text-[#475467] shadow-lg`}
          >
            {title ? (
              <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#171717]">
                <Icon size={14} className={`shrink-0 ${iconClassName}`} aria-hidden="true" />
                {title}
              </span>
            ) : null}
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * A small ⓘ that explains itself on hover or focus — for what used to be a line of grey
 * under a heading.
 *
 * A page read every day does not need telling every day what its parts are for; the
 * sentence is wanted the first time and in doubt, and costs a line of the page every
 * other time. This keeps it one hover away, beside the thing it explains.
 */
export function InfoTip({ children, label = "What this is", title }: { children: ReactNode; label?: string; title?: string }) {
  return (
    <Tip content={children} title={title}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex shrink-0 items-center rounded-full p-0.5 align-middle text-[#b4bcc8] hover:text-[#667085] focus-visible:text-[#667085]"
      >
        <Info size={13} aria-hidden="true" />
      </button>
    </Tip>
  );
}

/**
 * Broken wishes and rules, a line each, as the plan says them ("Must · Bilal Maaz: Can't
 * teach Tue 14:00–18:00"): the Must, the Would like or the Everybody as a tag in its colour.
 */
export function TipWishes({ lines }: { lines: string[] }) {
  return (
    <span className="grid gap-1">
      {lines.map((line) => {
        const [tag, ...rest] = line.split(" · ");
        const known = tag === "Must" || tag === "Would like" || tag === "Everybody";
        return (
          <span key={line} className="flex items-start gap-1.5">
            {known ? (
              <span
                className={`mt-px shrink-0 rounded px-1.5 text-[11px] font-semibold leading-[18px] ${
                  tag === "Must" ? "bg-[#fdf3f3] text-[#a6292f]" : "bg-[#fdf6e3] text-[#8a6116]"
                }`}
              >
                {tag}
              </span>
            ) : null}
            <span className="min-w-0 text-[#344054]">{known ? rest.join(" · ") : line}</span>
          </span>
        );
      })}
    </span>
  );
}

/** What to do — the line the reader came for, first and highlighted. */
export function TipDo({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 flex items-start gap-1.5 rounded-md bg-[#eef4fa] px-2 py-1.5 font-semibold text-[#1f4e79]">
      <ArrowRight size={13} className="mt-[3px] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** A small heading inside the bubble, over a group of points. */
export function TipHeading({ children }: { children: ReactNode }) {
  return <span className="mb-1 mt-2.5 block text-[10px] font-semibold uppercase tracking-wide text-[#8a94a4]">{children}</span>;
}

const DOTS = {
  plain: "bg-[#98a2b3]",
  good: "bg-[#2e7d55]",
  info: "bg-[#1f4e79]",
  caution: "bg-[#d99b1c]",
  serious: "bg-[#a6292f]",
} as const;

/**
 * One point: a bullet, or a step number. The bullet takes the page's colours when it stands
 * for one — the sets list's green, amber and red dots are explained by dots of their own.
 */
export function TipPoint({ children, tone = "plain", step }: { children: ReactNode; tone?: keyof typeof DOTS; step?: number }) {
  return (
    <span className="mt-1 flex items-start gap-2">
      {step ? (
        <span
          className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1f4e79] text-[10px] font-semibold leading-none text-white"
          aria-hidden="true"
        >
          {step}
        </span>
      ) : (
        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[tone]}`} aria-hidden="true" />
      )}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** A name as the page shows it — a set, a group, a course, a major — so it is recognised at a glance. */
export function TipPill({ children }: { children: ReactNode }) {
  return (
    <span className="mx-px inline-flex whitespace-nowrap rounded-full bg-[#e8edf3] px-1.5 text-[11px] font-semibold leading-[18px] text-[#1f4e79]">
      {children}
    </span>
  );
}

/** Each page with the icon it has in the sidebar, so a page named in a bubble is the one found there. */
const PAGES = {
  Students: Users,
  Cohorts: ListChecks,
  Courses: BookOpen,
  "Active CRNs": BookMarked,
  Teachers: GraduationCap,
  "Active teachers": UserCheck,
  "Part-time Teachers": Contact,
  Semesters: CalendarDays,
  "Semester plan": CalendarCheck,
  "Semester Timetable": CalendarRange,
  Rooms: DoorOpen,
  "Groups & CRNs": ListTree,
  "Group schema": Blocks,
  Capacity: GaugeCircle,
  "Teacher hours": Clock3,
} as const;

/**
 * A page of the app, named as the sidebar names it and wearing its icon — squared and
 * white, so it never reads as a value (a round tinted pill) or as a button's words (bold).
 */
export function TipPage({ name }: { name: keyof typeof PAGES }) {
  const Icon = PAGES[name];
  return (
    <span className="mx-px inline-flex items-center gap-1 whitespace-nowrap rounded border border-[#d6dde6] bg-white px-1.5 align-baseline text-[11px] font-semibold leading-[18px] text-[#344054] shadow-[0_1px_0_#e4e8ef]">
      <Icon size={11} className="shrink-0 text-[#1f4e79]" aria-hidden="true" />
      {name}
    </span>
  );
}

const BUTTON_LOOKS = {
  // The page's ordinary button: white, outlined, navy words — Fill TD, Add group, Workbook and lists.
  outline: "rounded-md border border-[#b7bec8] bg-white text-[#1f4e79] shadow-[0_1px_0_#e4e8ef]",
  // The one solid button a form has: + Set.
  solid: "rounded-md border border-[#1f4e79] bg-[#1f4e79] text-white",
  // Words that act: Say what TD asks for, Place them.
  link: "text-[#1f4e79] underline decoration-[#9fbfdc] underline-offset-2",
  // An amber count that is also a button: 6 in no group.
  warn: "rounded-full bg-[#fdf9ee] text-[#8a6116]",
  // A red mark on a card: no CRN.
  danger: "rounded-full bg-[#fdf3f3] text-[#a6292f]",
} as const;

/**
 * A button or a mark as it looks on the page, with its icon, so a bubble can say "press
 * this" and be found at a glance: [✦ Fill TD] rather than "the fill button".
 */
export function TipButton({
  children,
  icon: Icon,
  look = "outline",
}: {
  children: ReactNode;
  icon?: LucideIcon;
  look?: keyof typeof BUTTON_LOOKS;
}) {
  return (
    <span
      className={`mx-px inline-flex items-center gap-1 whitespace-nowrap align-baseline text-[11px] font-semibold leading-[18px] ${
        look === "link" ? "" : "px-1.5"
      } ${BUTTON_LOOKS[look]}`}
    >
      {Icon ? <Icon size={11} className="shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const STEP_TAGS = {
  when: "bg-[#f2f4f7] text-[#667085]",
  do: "bg-[#e8edf3] text-[#1f4e79]",
  then: "bg-[#e7f4ec] text-[#2e7d55]",
} as const;

function StepTag({ step }: { step: keyof typeof STEP_TAGS }) {
  return (
    <span className={`inline-flex w-10 justify-center rounded px-1 text-[10px] font-semibold uppercase leading-4 tracking-wide ${STEP_TAGS[step]}`}>
      {step}
    </span>
  );
}

/**
 * One real case of use, from the department's own sets: the situation, what to do in it,
 * and what follows. A value shows what a field holds; a case shows why anybody would fill it.
 *
 * `other` is a second case in one line, for a setting with two ways of being used or one
 * easily mistaken for another: "Other case" for the second way, "Not this case" for when
 * a different setting is the one wanted.
 */
export function TipUsage({
  when,
  todo,
  then,
  other,
  otherLabel = "Other case",
}: {
  when: ReactNode;
  todo: ReactNode;
  then: ReactNode;
  other?: ReactNode;
  otherLabel?: "Other case" | "Not this case";
}) {
  return (
    <span className="mt-2.5 block rounded-md border border-dashed border-[#cfd8e3] bg-[#fbfcfe] px-2.5 py-2">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[#2e7d55]">Example of use</span>
      <span className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1">
        <StepTag step="when" />
        <span>{when}</span>
        <StepTag step="do" />
        <span className="text-[#344054]">{todo}</span>
        <StepTag step="then" />
        <span>{then}</span>
      </span>
      {other ? (
        <span className="mt-2 flex items-baseline gap-2 border-t border-dashed border-[#d9dee7] pt-2">
          <span className="inline-flex shrink-0 rounded bg-[#fdf9ee] px-1 text-[10px] font-semibold uppercase leading-4 tracking-wide text-[#8a6116]">
            {otherLabel}
          </span>
          <span>{other}</span>
        </span>
      ) : null}
    </span>
  );
}

/** What goes wrong if it is left undone. */
export function TipWarn({ children }: { children: ReactNode }) {
  return (
    <span className="mt-2 flex items-start gap-1.5 font-medium text-[#a6292f]">
      <AlertTriangle size={12} className="mt-[3px] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
