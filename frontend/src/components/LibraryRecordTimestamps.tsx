type Props = {
  createdAt: string;
  updatedAt: string;
  now?: Date;
  className?: string;
};

export function LibraryRecordTimestamps({ createdAt, updatedAt, now = new Date(), className = "" }: Props) {
  const created = toDate(createdAt);
  const updated = toDate(updatedAt);
  if (!created || !updated) return null;

  return <span className={`mt-2 flex flex-wrap gap-2 text-xs ${className}`.trim()}><span className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-2 py-1 text-[#667085]"><CalendarPlus size={14} aria-hidden="true" />Created: {formatDateTime(created)}</span><span className="inline-flex items-center gap-1.5 rounded-md border border-[#d7e5f3] bg-[#f2f7fb] px-2 py-1 text-[#1f4e79]"><Clock3 size={14} aria-hidden="true" />Updated: {formatUpdatedAt(updated, now)}</span></span>;
}

function formatUpdatedAt(updatedAt: Date, now: Date) {
  const minutesAgo = Math.floor((now.getTime() - updatedAt.getTime()) / 60_000);
  if (minutesAgo < 1) return "just now";
  if (minutesAgo < 60) return `${minutesAgo} minute${minutesAgo === 1 ? "" : "s"} ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo} hour${hoursAgo === 1 ? "" : "s"} ago`;
  return formatDateTime(updatedAt);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}

function toDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
import { CalendarPlus, Clock3 } from "lucide-react";
