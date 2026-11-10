import { Flag, Search } from "lucide-react";

import { FilterMenu, FilterPills } from "@/components/PanelFilter";
import { SortMenu } from "@/components/SortMenu";
import { usePageState } from "@/components/usePageState";
import type { Breach, Tally, WishCheck, WishCollection, WishLevel } from "@/services/teacherWishes";

export type WishView = "week" | "all" | "teachers";

/** The panel's three views, switched from its header beside the tabs. */
export const WISH_VIEWS: { value: WishView; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "all", label: "All weeks" },
  { value: "teachers", label: "By teacher" },
];

type WishShow = "must" | "would" | "everybody" | "submitted" | "draft" | "comment";
type WishSort = "must" | "teacher" | "week" | "classes";

const WISH_SHOW: { value: WishShow; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "would", label: "Would like" },
  { value: "everybody", label: "Everybody" },
  { value: "submitted", label: "Submitted" },
  { value: "draft", label: "Draft" },
  { value: "comment", label: "With a comment" },
];
const WISH_SORT: { value: WishSort; label: string }[] = [
  { value: "must", label: "Musts first" },
  { value: "teacher", label: "Teacher" },
  { value: "week", label: "Week" },
  { value: "classes", label: "Classes affected" },
];
const EVERY_TEACHER = "";

function Level({ about, level }: { about: Breach["about"]; level: WishLevel | null }) {
  if (about === "period") {
    return <span className="shrink-0 rounded bg-[#fdf6e3] px-1.5 text-[11px] font-semibold text-[#8a6116]">Everybody</span>;
  }
  return level === "must" ? (
    <span className="shrink-0 rounded bg-[#fdf3f3] px-1.5 text-[11px] font-semibold text-[#a6292f]">Must</span>
  ) : (
    <span className="shrink-0 rounded bg-[#fdf6e3] px-1.5 text-[11px] font-semibold text-[#8a6116]">Would like</span>
  );
}

/** "Weeks 1–3, 5": the weeks a wish is broken in, said as runs. */
function weeksSaid(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    runs.push(end > index ? `${sorted[index]}–${sorted[end]}` : `${sorted[index]}`);
    index = end;
  }
  return `${sorted.length === 1 ? "Week" : "Weeks"} ${runs.join(", ")}`;
}

/**
 * One line of the panel, whichever view: a wish broken this week, a wish with every week it is
 * broken in, or a teacher with how well the plan serves them. Searched, filtered and sorted
 * the same way in all three.
 */
type Item = {
  key: string;
  about: Breach["about"];
  /** For a teacher's line, the worst they have lost; null when nothing is. */
  level: WishLevel | null;
  teacherId: string;
  teacherName: string;
  status: Tally["status"] | null;
  comment: boolean;
  classes: number;
  weeks: number[];
  text: string;
  breach?: Breach;
  tally?: Tally;
};

/**
 * The teachers' wishes the plan breaks, beside the week: this week's, every week's, or how
 * well each teacher is served — the least served first, so broken wishes are spread rather
 * than always landing on the same people. Searched, sorted and filtered as the classes to
 * place are, in the same layout: the filters behind one button, "Must" to hand. Which of
 * the three views is the panel's header's to say. A line is pressed to show that teacher's week.
 */
export function PlanWishesPanel({
  check,
  collection,
  week,
  view,
  onFocus,
  failed,
}: {
  check: WishCheck | null;
  collection: WishCollection | null;
  /** The teaching week on screen, or null between weeks. */
  week: number | null;
  view: WishView;
  /** Show this teacher's wishes on the grid. */
  onFocus: (teacherId: string) => void;
  failed?: string;
}) {
  const [search, setSearch] = usePageState("semester-plan:wish-search", "");
  const [chosen, setChosen] = usePageState<WishShow[]>("semester-plan:wish-filters", []);
  const [sort, setSort] = usePageState<WishSort>("semester-plan:wish-sort", "must");
  const [teacher, setTeacher] = usePageState("semester-plan:wish-teacher", EVERY_TEACHER);

  const breaches = check?.breaches ?? [];
  const tallies = check?.tallies ?? [];
  const statusOf = new Map(tallies.map((tally) => [tally.teacherId, tally.status]));
  const fromBreach = (breach: Breach, key: string, weeks: number[], classes: number): Item => ({
    key,
    about: breach.about,
    level: breach.level,
    teacherId: breach.teacherId,
    teacherName: breach.teacherName,
    status: statusOf.get(breach.teacherId) ?? null,
    comment: Boolean(breach.comment),
    classes,
    weeks,
    text: [breach.teacherName, breach.wish, breach.how, breach.comment].join(" ").toLowerCase(),
    breach,
  });

  // This week's, one line for each wish broken.
  const weekItems = breaches
    .filter((breach) => breach.week === week)
    .map((breach, index) => fromBreach(breach, `${breach.about}|${breach.teacherId}|${breach.key}|${index}`, [breach.week], breach.classes.length));

  // Every week's, one line per wish broken, with the weeks it is broken in.
  const grouped = new Map<string, { breach: Breach; weeks: number[]; classes: number; how: string[] }>();
  for (const breach of breaches) {
    const key = `${breach.about}|${breach.teacherId}|${breach.key}`;
    const held = grouped.get(key) ?? { breach, weeks: [], classes: 0, how: [] };
    held.weeks.push(breach.week);
    held.classes += breach.classes.length;
    held.how.push(breach.how);
    grouped.set(key, held);
  }
  const allItems = [...grouped.entries()].map(([key, held]) => {
    const item = fromBreach(held.breach, key, held.weeks, held.classes);
    return { ...item, text: `${item.text} ${held.how.join(" ").toLowerCase()}` };
  });

  // A teacher each, with the worst they have lost.
  const teacherItems = tallies.map<Item>((tally) => {
    const theirs = breaches.filter((breach) => breach.about === "teacher" && breach.teacherId === tally.teacherId);
    return {
      key: tally.teacherId,
      about: "teacher",
      level: tally.musts > tally.mustsKept ? "must" : tally.woulds > tally.wouldsKept ? "would" : null,
      teacherId: tally.teacherId,
      teacherName: tally.teacherName,
      status: tally.status,
      comment: theirs.some((breach) => breach.comment),
      classes: new Set(theirs.flatMap((breach) => breach.classes)).size,
      weeks: theirs.map((breach) => breach.week),
      text: [tally.teacherName, ...theirs.map((breach) => `${breach.wish} ${breach.how} ${breach.comment}`)].join(" ").toLowerCase(),
      tally,
    };
  });

  const items = view === "week" ? weekItems : view === "all" ? allItems : teacherItems;
  const words = search.trim().toLowerCase();
  const searched = items.filter((item) => !words || item.text.includes(words));
  const found = searched.filter((item) => !teacher || item.teacherId === teacher);
  const keeps = (choice: WishShow, item: Item) =>
    choice === "must"
      ? item.about === "teacher" && item.level === "must"
      : choice === "would"
        ? item.about === "teacher" && item.level === "would"
        : choice === "everybody"
          ? item.about === "period"
          : choice === "submitted"
            ? item.status === "submitted"
            : choice === "draft"
              ? item.status === "draft"
              : item.comment;
  const keepsAll = (choices: WishShow[], item: Item) => choices.every((choice) => keeps(choice, item));
  // How many each would leave, with the others chosen: the ones leaving none are not offered.
  const counts = Object.fromEntries(
    WISH_SHOW.map((option) => [option.value, found.filter((item) => keepsAll([...chosen.filter((each) => each !== option.value), option.value], item)).length]),
  ) as Record<WishShow, number>;
  const toggle = (choice: WishShow) =>
    setChosen((current) => (current.includes(choice) ? current.filter((each) => each !== choice) : [...current, choice]));
  const musts = (left: Item, right: Item) =>
    Number(left.level !== "must") - Number(right.level !== "must") || left.teacherName.localeCompare(right.teacherName);
  const order: Record<WishSort, (left: Item, right: Item) => number> = {
    // By teacher, the least served first: the panel's own order for that view.
    must: view === "teachers" ? () => 0 : musts,
    teacher: (left, right) => left.teacherName.localeCompare(right.teacherName) || musts(left, right),
    week: (left, right) => Math.min(...left.weeks, 99) - Math.min(...right.weeks, 99) || musts(left, right),
    classes: (left, right) => right.classes - left.classes || musts(left, right),
  };
  const shown = found.filter((item) => keepsAll(chosen, item)).sort(order[sort]);

  // The teachers to choose from, each with how many lines of theirs the other filters leave.
  const teacherOptions = [...new Map([...breaches, ...tallies].filter((each) => each.teacherId).map((each) => [each.teacherId, each.teacherName])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([value, label]) => ({ value, label, count: searched.filter((item) => item.teacherId === value && keepsAll(chosen, item)).length }));
  const teacherName = teacherOptions.find((option) => option.value === teacher)?.label ?? "";

  const line = (item: Item) => {
    if (item.tally) {
      const tally = item.tally;
      return (
        <button
          type="button"
          onClick={() => onFocus(tally.teacherId)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#f8fafc]"
        >
          <Flag
            size={11}
            aria-hidden="true"
            className={item.level === "must" ? "text-[#a6292f]" : item.level === "would" ? "text-[#d99b1c]" : "text-[#cfd8e3]"}
            fill="currentColor"
          />
          <span className="min-w-0 flex-1 truncate font-semibold text-[#344054]">
            {tally.teacherName}
            {tally.status === "draft" ? <span className="ml-1 font-normal text-[#98a2b3]">(draft)</span> : null}
          </span>
          <span className="shrink-0 tabular-nums text-[#667085]">
            {tally.musts ? `${tally.mustsKept} of ${tally.musts} Musts` : "no Musts"} ·{" "}
            {tally.woulds ? `${tally.wouldsKept} of ${tally.woulds} wishes` : "no wishes"}
          </span>
        </button>
      );
    }
    const breach = item.breach as Breach;
    return (
      <button
        type="button"
        onClick={() => breach.teacherId && onFocus(breach.teacherId)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]"
      >
        <Level about={breach.about} level={breach.level} />
        <span className="min-w-0 flex-1 text-xs">
          <span className="block font-semibold text-[#344054]">
            {breach.about === "period" ? breach.wish : `${breach.teacherName} · ${breach.wish}`}
          </span>
          {breach.comment ? <span className="block text-[#667085]">&ldquo;{breach.comment}&rdquo;</span> : null}
          <span className="block text-[#98a2b3]">
            {view === "all" ? `${weeksSaid(item.weeks)} · ${item.classes} class${item.classes === 1 ? "" : "es"}` : breach.how}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-2 border-b border-[#eef1f5] px-3 py-2.5">
        {/* The search, and the order as an icon beside it, as the classes to place have them. */}
        <div className="flex items-center gap-1.5">
          <label className="relative block min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#667085]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search wishes"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Teacher, course or wish"
              className="w-full rounded-md border border-[#d3d9e2] bg-white py-1.5 pl-8 pr-2 text-sm"
            />
          </label>
          <SortMenu value={sort} options={WISH_SORT} onChange={setSort} />
          <FilterMenu
            options={WISH_SHOW.map((option) => ({ ...option, count: counts[option.value] }))}
            chosen={chosen}
            onToggle={toggle}
            teachers={{ options: teacherOptions, chosen: teacher, onChoose: setTeacher }}
          />
        </div>
        <FilterPills
          shortcut={{ label: "Must", count: counts.must }}
          on={chosen.includes("must")}
          onShortcut={() => toggle("must")}
          pills={[
            ...chosen
              .filter((choice) => choice !== "must")
              .map((choice) => ({ key: choice, label: WISH_SHOW.find((option) => option.value === choice)?.label ?? choice, onRemove: () => toggle(choice) })),
            ...(teacher ? [{ key: "teacher", label: teacherName || "One teacher", onRemove: () => setTeacher(EVERY_TEACHER) }] : []),
          ]}
        />
        {failed ? <p className="text-xs text-[#a6292f]">{failed}</p> : null}
        {!collection && !failed ? (
          <p className="text-xs text-[#667085]">
            No wishes collected for this semester yet. Open the collection on the Timetable wishes page, under Teachers.
          </p>
        ) : null}
        {check?.unanswered.length ? (
          <p className="text-xs text-[#667085]" title={check.unanswered.join(", ")}>
            {check.unanswered.length} teacher{check.unanswered.length === 1 ? " hasn't" : "s haven't"} answered yet.
          </p>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-[#f2f4f7] overflow-y-auto" aria-label={view === "teachers" ? "Teachers" : "Broken wishes"}>
        {shown.map((item) => (
          <li key={item.key}>{line(item)}</li>
        ))}
        {!shown.length ? (
          <li className="px-3 py-6 text-center text-xs text-[#98a2b3]">
            {items.length
              ? "No wish here matches."
              : view === "teachers"
                ? "No teacher with classes here has answered yet."
                : collection || breaches.length
                  ? "Nothing broken."
                  : ""}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
