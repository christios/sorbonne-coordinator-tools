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
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import {
  type AnnouncementLevel,
  PlatformAnnouncement,
  fetchAnnouncements,
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
const LEVEL_CHOICES: Array<{ value: AnnouncementLevel; label: string }> = [
  { value: "notice", label: "Notice — sits in the strip" },
  { value: "important", label: "Important — opens once" },
  { value: "urgent", label: "Urgent — opens once, in red" },
];

type Row = { key: string; id: string; icon: string; level: AnnouncementLevel; message: string };

function toRows(announcements: PlatformAnnouncement[]): Row[] {
  return announcements.map((announcement, index) => ({
    key: announcement.id ?? `row-${index}`,
    id: announcement.id ?? "",
    icon: announcement.icon,
    level: announcement.level ?? "notice",
    message: announcement.message,
  }));
}

/**
 * The strip above the student header. The coordinator writes the lines and picks
 * an icon for each; the student platform owns how they are laid out.
 */
export function AnnouncementEditor() {
  const queryClient = useQueryClient();
  const announcements = useQuery({ queryKey: ["platform-announcements"], queryFn: fetchAnnouncements });
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (announcements.data) setRows(toRows(announcements.data.announcements));
  }, [announcements.data]);

  const save = useMutation({
    mutationFn: () =>
      saveAnnouncements(
        rows.map(({ id, icon, level, message }) => ({ id, icon, level, message: message.trim() })),
      ),
    onSuccess: (result) => {
      setRows(toRows(result));
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["platform-announcements"] });
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
      { key: `new-${Date.now()}`, id: "", icon: "info", level: "notice", message: "" },
    ]);
  }

  function removeRow(key: string) {
    setSaved(false);
    setRows((current) => current.filter((row) => row.key !== key));
  }

  const incomplete = rows.some((row) => row.message.trim().length === 0);

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-6">
      <h2 className="text-lg font-semibold text-[#171717]">Announcement strip</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">
        Short notices shown above the header on the student platform. The strip folds away as a student scrolls
        down and returns when they scroll back to the top. Leave it empty to hide it entirely.
      </p>

      {announcements.isLoading ? (
        <p className="mt-5 text-sm text-[#667085]">Loading the current strip…</p>
      ) : announcements.error ? (
        <p role="alert" className="mt-5 text-sm text-[#a6292f]">
          {(announcements.error as Error).message}
        </p>
      ) : (
        <>
          <ul className="mt-5 space-y-3">
            {rows.map((row) => {
              const Icon = ICONS.get(row.icon) ?? Info;
              return (
                <li key={row.key} className="flex flex-wrap items-end gap-3 md:flex-nowrap">
                  <span className="mb-2 flex size-9 shrink-0 items-center justify-center rounded-md bg-[#eaf1f8] text-[#1f4e79]">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="w-44 shrink-0">
                    <SelectMenu
                      label="Icon"
                      value={row.icon}
                      onChange={(icon) => update(row.key, { icon })}
                      options={ICON_CHOICES.map(({ value, label }) => ({ value, label }))}
                    />
                  </div>
                  <div className="w-52 shrink-0">
                    <SelectMenu
                      label="How much it matters"
                      value={row.level}
                      onChange={(level) => update(row.key, { level: level as AnnouncementLevel })}
                      options={LEVEL_CHOICES}
                    />
                  </div>
                  <label className="min-w-0 flex-1 text-sm font-semibold text-[#344054]">
                    Announcement
                    <input
                      value={row.message}
                      maxLength={MAX_MESSAGE_LENGTH}
                      onChange={(event) => update(row.key, { message: event.target.value })}
                      placeholder="Week 1 starts Monday 31 August"
                      className="mt-1.5 w-full rounded-md border border-[#c8d0db] bg-white px-3 py-2.5 text-sm font-normal text-[#1f2937] outline-none focus:border-[#1f4e79] focus:ring-3 focus:ring-[#dceaf6]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label={`Remove announcement ${row.message || "(empty)"}`}
                    className="mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#d9dee7] text-[#a6292f] hover:bg-[#fdf3f3]"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          {rows.length === 0 ? (
            <p className="mt-5 rounded-md border border-dashed border-[#c8d0db] px-4 py-6 text-center text-sm text-[#667085]">
              No announcements. Students see the header on its own.
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= 8}
              className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:text-[#9ba8b5]"
            >
              <Plus size={16} aria-hidden="true" /> Add announcement
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || incomplete}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              Save strip
            </button>
            {incomplete ? <span className="text-sm text-[#667085]">Every announcement needs some text.</span> : null}
            {saved && !save.isPending ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2f6b3d]">
                <CheckCircle2 size={16} aria-hidden="true" /> Saved
              </span>
            ) : null}
          </div>

          {save.error ? (
            <p role="alert" className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
              {(save.error as Error).message}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
