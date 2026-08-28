import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  GraduationCap,
  Info,
  Link2,
  Loader2,
  MapPin,
  Megaphone,
  NotebookPen,
  Plus,
  Trash2,
  Users,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import {
  type AnnouncementLevel,
  PlatformAnnouncement,
  fetchAnnouncements,
  fetchTimetableTerms,
  saveAnnouncements,
} from "@/services/timetables";

const MAX_MESSAGE_LENGTH = 160;

/** Mirrors the icons the student platform accepts, with the label shown here. */
const ICON_CHOICES: Array<{ value: string; label: string; icon: LucideIcon }> = [
  { value: "info", label: "Information", icon: Info },
  { value: "alert", label: "Warning", icon: TriangleAlert },
  { value: "megaphone", label: "Announcement", icon: Megaphone },
  { value: "calendar", label: "Date", icon: CalendarDays },
  { value: "clock", label: "Time", icon: Clock },
  { value: "location", label: "Place", icon: MapPin },
  { value: "book", label: "Course", icon: BookOpen },
  { value: "exam", label: "Exam", icon: NotebookPen },
  { value: "graduation", label: "Graduation", icon: GraduationCap },
  { value: "link", label: "Link", icon: Link2 },
];

const ICONS = new Map(ICON_CHOICES.map((choice) => [choice.value, choice.icon]));

/**
 * How much a notice matters, which the student platform turns into how loudly it lands.
 *
 * "Notice" sits in the strip as everything used to. The two above it open as a card over
 * the student's timetable until they acknowledge it, so they are worth spending sparingly
 * — a strip where everything is urgent is a strip where nothing is.
 */
const LEVEL_CHOICES: Array<{
  value: AnnouncementLevel;
  label: string;
  hint: string;
  card: string;
  ink: string;
  chip: string;
}> = [
  {
    value: "notice",
    label: "Notice",
    hint: "sits in the strip",
    card: "border-[#cfe0ef] bg-[#f7fafd]",
    ink: "text-[#1f4e79]",
    chip: "bg-[#1f4e79] text-white",
  },
  {
    value: "important",
    label: "Important",
    hint: "opens over the timetable",
    card: "border-[#e8d9ac] bg-[#fdfaf1]",
    ink: "text-[#8a6116]",
    chip: "bg-[#8a6116] text-white",
  },
  {
    value: "urgent",
    label: "Urgent",
    hint: "opens over the timetable, in red",
    card: "border-[#e5b7b9] bg-[#fdf6f6]",
    ink: "text-[#a6292f]",
    chip: "bg-[#a6292f] text-white",
  },
];

const LOOK = new Map(LEVEL_CHOICES.map((choice) => [choice.value, choice]));

/**
 * How much a notice matters, as three buttons rather than a dropdown.
 *
 * The choice is between three things and it decides what the notice looks like, so it
 * should be visible without opening anything — and the control can wear the same colours
 * the student will see, which a list of words in a menu cannot.
 */
function LevelPicker({
  value,
  onChange,
}: {
  value: AnnouncementLevel;
  onChange: (level: AnnouncementLevel) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="How much it matters"
      className="inline-flex shrink-0 rounded-md border border-[#d9dee7] bg-white p-0.5"
    >
      {LEVEL_CHOICES.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          title={choice.hint}
          onClick={() => onChange(choice.value)}
          className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
            value === choice.value ? choice.chip : `${choice.ink} hover:bg-[#f5f7fa]`
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** Everybody in the semester. Empty rather than a sentinel, because it is what is stored. */
const EVERYONE = "";

type Row = {
  key: string;
  id: string;
  icon: string;
  level: AnnouncementLevel;
  cohortKey: string;
  message: string;
};

function toRows(announcements: PlatformAnnouncement[]): Row[] {
  return announcements.map((announcement, index) => ({
    key: announcement.id ?? `row-${index}`,
    id: announcement.id ?? "",
    icon: announcement.icon,
    level: announcement.level ?? "notice",
    cohortKey: announcement.cohortKey ?? EVERYONE,
    message: announcement.message,
  }));
}

/**
 * The strip above the student header. The coordinator writes the lines and picks
 * an icon for each; the student platform owns how they are laid out.
 */
export function AnnouncementEditor() {
  const queryClient = useQueryClient();
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms });
  const [termId, setTermId] = useState("");
  const semesters = useMemo(() => terms.data ?? [], [terms.data]);

  // Land on a semester rather than on nothing, the way the other pickers do.
  useEffect(() => {
    if (semesters.length && !semesters.some((term) => term.id === termId)) setTermId(semesters[0].id);
  }, [semesters, termId]);

  const announcements = useQuery({
    queryKey: ["platform-announcements", termId],
    queryFn: () => fetchAnnouncements(termId),
    enabled: Boolean(termId),
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (announcements.data) setRows(toRows(announcements.data.announcements));
  }, [announcements.data]);

  const save = useMutation({
    mutationFn: () =>
      saveAnnouncements(
        termId,
        rows.map(({ id, icon, level, cohortKey, message }) => ({
          id,
          icon,
          level,
          cohortKey,
          message: message.trim(),
        })),
      ),
    onSuccess: (result) => {
      setRows(toRows(result));
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["platform-announcements", termId] });
    },
  });

  function update(key: string, patch: Partial<Row>) {
    setSaved(false);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setSaved(false);
    setRows((current) => [
      ...current,
      { key: `new-${Date.now()}`, id: "", icon: "info", level: "notice", cohortKey: EVERYONE, message: "" },
    ]);
  }

  function removeRow(key: string) {
    setSaved(false);
    setRows((current) => current.filter((row) => row.key !== key));
  }

  const incomplete = rows.some((row) => row.message.trim().length === 0);

  const cohorts = announcements.data?.cohorts ?? [];
  const audiences = [
    { value: EVERYONE, label: "Everyone this semester" },
    ...cohorts.map((cohort) => ({ value: cohort.key, label: `${cohort.name} (${cohort.students})` })),
  ];

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white">
      {/*
        * The semester and the save sit together at the top, because they are the two
        * things that are true of the whole strip. Everything between them is one notice.
        */}
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e4e8ef] px-5 py-3">
        <div className="w-fit min-w-[13rem] max-w-[24rem]">
          <SelectMenu
            label="Semester"
            value={termId}
            onChange={setTermId}
            disabled={!semesters.length}
            placeholder={terms.isLoading ? "Loading…" : "No semester uploaded yet"}
            options={semesters.map((term) => ({ value: term.id, label: term.name }))}
          />
        </div>
        <p className="text-sm text-[#667085]">
          {rows.length === 0
            ? "No notices"
            : `${rows.length} notice${rows.length === 1 ? "" : "s"}`}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {incomplete ? (
            <span className="text-sm text-[#667085]">Every notice needs some words.</span>
          ) : null}
          {saved && !save.isPending ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2f6b3d]">
              <CheckCircle2 size={16} aria-hidden="true" /> Saved
            </span>
          ) : null}
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 8 || !termId}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:text-[#9ba8b5]"
          >
            <Plus size={16} aria-hidden="true" /> Add announcement
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || incomplete || !termId}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
          >
            {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            Save strip
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
      {!termId && !terms.isLoading ? (
        <p className="text-sm text-[#667085]">Import a semester before writing notices for it.</p>
      ) : announcements.isLoading ? (
        <p className="text-sm text-[#667085]">Loading the current strip…</p>
      ) : announcements.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">
          {(announcements.error as Error).message}
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((row) => {
              const Icon = ICONS.get(row.icon) ?? Info;
              const look = LOOK.get(row.level) ?? LEVEL_CHOICES[0];
              const audience = audiences.find((option) => option.value === row.cohortKey);
              return (
                /*
                 * The row is the notice: it carries the colour and the icon the student
                 * will see, so the effect of a choice is visible where the choice is made
                 * rather than only on a phone somewhere afterwards.
                 */
                <li key={row.key} className={`rounded-lg border px-4 py-3 ${look.card}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 shrink-0 ${look.ink}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <input
                      aria-label="Announcement"
                      value={row.message}
                      maxLength={MAX_MESSAGE_LENGTH}
                      onChange={(event) => update(row.key, { message: event.target.value })}
                      placeholder="Week 1 starts Monday 31 August"
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-white/70 px-3 py-2 text-sm text-[#1f2937] outline-none placeholder:text-[#98a2b3] focus:border-[#1f4e79] focus:bg-white focus:ring-3 focus:ring-[#dceaf6]"
                    />
                    {MAX_MESSAGE_LENGTH - row.message.length <= 30 ? (
                      <span
                        className={`mt-2 shrink-0 text-xs tabular-nums ${
                          MAX_MESSAGE_LENGTH - row.message.length <= 10
                            ? "font-semibold text-[#a6292f]"
                            : "text-[#98a2b3]"
                        }`}
                      >
                        {MAX_MESSAGE_LENGTH - row.message.length} left
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label={`Remove announcement ${row.message || "(empty)"}`}
                      className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[#98a2b3] hover:bg-white hover:text-[#a6292f]"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-8">
                    <LevelPicker
                      value={row.level}
                      onChange={(level) => update(row.key, { level })}
                    />
                    <span className="text-xs text-[#98a2b3]">{look.hint}</span>
                    <span aria-hidden="true" className="mx-1 h-4 w-px bg-[#d9dee7]" />
                    <div className="w-36">
                      <SelectMenu
                        label="Icon"
                        value={row.icon}
                        onChange={(icon) => update(row.key, { icon })}
                        options={ICON_CHOICES.map(({ value, label }) => ({ value, label }))}
                      />
                    </div>
                    <div className="w-56">
                      <SelectMenu
                        label="Who sees it"
                        value={row.cohortKey}
                        onChange={(cohortKey) => update(row.key, { cohortKey })}
                        options={audiences}
                      />
                    </div>
                    {row.cohortKey !== EVERYONE && !audience ? (
                      // The cohort was on this semester when the notice was written and
                      // is not now, so nobody would receive it.
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#a6292f]">
                        <Users size={13} aria-hidden="true" />
                        Not a cohort on this semester
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {rows.length === 0 ? (
            <p className="mt-5 rounded-md border border-dashed border-[#c8d0db] px-4 py-6 text-center text-sm text-[#667085]">
              No announcements. Students see the header on its own.
            </p>
          ) : null}

          {save.error ? (
            <p role="alert" className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
              {(save.error as Error).message}
            </p>
          ) : null}
        </>
      )}
      </div>
    </section>
  );
}
