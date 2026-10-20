/**
 * Every section whose classes the registrar has changed, in one place: what went, what
 * arrived, and what the department makes of it.
 *
 * The banners on Active CRNs and Active teachers say how many are waiting and send people
 * here. Here a coordinator can do three things, none of which the sweep can do for them:
 *
 * - link a class that went to the class it was rescheduled into — the registrar's meetings
 *   carry no identity between sweeps, so "moved" is a judgement, and only somebody who
 *   knows the course is entitled to make it;
 * - put a note on any single class ("room clash, the registrar moved it");
 * - approve the change, which stays a separate act: explaining a change is not saying it
 *   is fine.
 *
 * Approved changes stay on the page under their own filter, saying who approved them and
 * when — they used to vanish from the banner with no way to look at them again.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Link2, MessageSquare, Search, Unlink, X } from "lucide-react";
import { useMemo, useState } from "react";

import { SectionDiff } from "@/components/ClassChanges";
import { SourceMark } from "@/components/DataTable";
import { SelectMenu } from "@/components/SelectMenu";
import { minutesOf, oursSaid } from "@/services/classDiff";
import {
  classKey,
  fetchChangedClasses,
  fetchClassNotes,
  fetchSweptTerms,
  fetchTermLinks,
  linkClasses,
  noteClass,
  unlinkClasses,
  type ChangedClasses,
  type ClassLink,
  type ClassNote,
  type ClassSlot,
} from "@/services/portalLists";
import { fetchTimetableTerms } from "@/services/timetables";
import { formatRoom } from "@/services/weekSchedule";
import { dismissalsByKey, fetchDismissals, setDismissal } from "@/services/warningDismissals";

type Show = "waiting" | "approved" | "all";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 3 Nov". */
function dayOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const made = new Date(year, month - 1, day);
  return Number.isNaN(made.getTime()) ? iso : `${DAYS[made.getDay()]} ${day} ${MONTHS[month - 1]}`;
}

/** "Tue 3 Nov, 08:30–10:00". */
function slotSaid(cls: ClassSlot): string {
  return `${dayOf(cls.meetsOn)}, ${cls.startsAt.slice(0, 5)}–${cls.endsAt.slice(0, 5)}`;
}

/** Every section of a term laid against the same months, so a gap reads as a gap. */
function spanOf(sections: ChangedClasses[]): { from: string; to: string } | undefined {
  const dates = sections
    .flatMap((section) => [...section.kept, ...section.removed, ...section.added].map((meeting) => meeting.meetsOn))
    .sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : undefined;
}

/** Who approved which change, and the press that approves one. */
function useApprovals() {
  const client = useQueryClient();
  const dismissals = useQuery({ queryKey: ["warning-dismissals"], queryFn: fetchDismissals, retry: false });
  const approvals = useMemo(() => dismissalsByKey(dismissals.data ?? []), [dismissals.data]);
  const approve = useMutation({
    mutationFn: (key: string) => setDismissal(key, true),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["warning-dismissals"] }),
  });
  return { approvals, approve };
}

export function ClassChangesPage({ place = "", onLeavePlace }: { place?: string; onLeavePlace?: () => void }) {
  // Opened from a CRN's record, at "<term>:<crn>": its term, and that CRN alone, approved or not.
  const [placeTerm, placeCrn] = place.includes(":") ? place.split(":") : ["", ""];
  const swept = useQuery({ queryKey: ["swept-terms"], queryFn: fetchSweptTerms, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const [picked, setPicked] = useState(placeTerm);
  const termCode = picked || swept.data?.[0] || "";
  const [show, setShow] = useState<Show>(placeCrn ? "all" : "waiting");
  const [search, setSearch] = useState(placeCrn);
  // Another CRN's record linking here while the page is open shows that CRN instead.
  const [shownPlace, setShownPlace] = useState(place);
  if (place !== shownPlace) {
    setShownPlace(place);
    if (placeCrn) {
      setPicked(placeTerm);
      setShow("all");
      setSearch(placeCrn);
    }
  }
  // Looking at anything else forgets the CRN, so the sidebar's Class changes is the whole page again.
  const leave = () => {
    if (place) onLeavePlace?.();
  };

  const changed = useQuery({
    queryKey: ["changed-classes", termCode],
    queryFn: () => fetchChangedClasses(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const notes = useQuery({
    queryKey: ["class-notes", termCode],
    queryFn: () => fetchClassNotes(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const { approvals, approve } = useApprovals();

  /** A semester's name, where the portal term is linked to one. */
  const termName = (code: string) => {
    const id = Object.entries(links.data ?? {}).find(([, linked]) => linked === code)?.[0];
    const name = (terms.data ?? []).find((term) => term.id === id)?.name;
    return name ? `${name} (${code})` : code;
  };

  const sections = useMemo(() => changed.data ?? [], [changed.data]);
  const waiting = sections.filter((section) => !approvals.has(section.key));
  const approved = sections.filter((section) => approvals.has(section.key));
  const words = search.trim().toLowerCase();
  const shown = (show === "waiting" ? waiting : show === "approved" ? approved : sections).filter(
    (section) =>
      !words ||
      [section.crn, section.courseCode, section.title, section.teacherName].some((field) =>
        (field || "").toLowerCase().includes(words),
      ),
  );
  const span = useMemo(() => spanOf(sections), [sections]);
  const linksOf = (crn: string) => (notes.data?.links ?? []).filter((link) => link.crn === crn && link.matches);
  const notesOf = (crn: string) => (notes.data?.notes ?? []).filter((note) => note.crn === crn && note.matches);
  const stale = [
    ...(notes.data?.links ?? []).filter((link) => !link.matches),
    ...(notes.data?.notes ?? []).filter((note) => !note.matches),
  ];
  const tab = (value: Show, label: string, count: number) => (
    <button
      type="button"
      onClick={() => {
        leave();
        setShow(value);
      }}
      aria-pressed={show === value}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
        show === value ? "bg-[#1f4e79] text-white" : "text-[#344054] hover:bg-[#f2f7fb]"
      }`}
    >
      {label} <span className={`ml-1 tabular-nums ${show === value ? "text-white/75" : "text-[#98a2b3]"}`}>{count}</span>
    </button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SelectMenu
            label="Semester"
            value={termCode}
            onChange={(code) => {
              leave();
              setPicked(code);
            }}
            options={(swept.data ?? []).map((code) => ({ value: code, label: termName(code) }))}
            placeholder={swept.isPending ? "Reading…" : "No semester swept yet"}
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[#d9dee7] bg-white p-1">
          {tab("waiting", "To look at", waiting.length)}
          {tab("approved", "Approved", approved.length)}
          {tab("all", "All", sections.length)}
        </div>
        <label className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#98a2b3]" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => {
              leave();
              setSearch(event.target.value);
            }}
            placeholder="Course, CRN or teacher"
            aria-label="Find a section"
            className="h-9 w-64 rounded-md border border-[#d0d5dd] pl-8 pr-3 text-sm"
          />
        </label>
      </div>

      {changed.isPending && termCode ? <p className="text-sm text-[#667085]">Reading the changes…</p> : null}
      {!changed.isPending && !shown.length ? (
        <p className="rounded-lg border border-dashed border-[#d0d5dd] px-4 py-6 text-sm text-[#667085]">
          {show === "waiting"
            ? "Nothing to look at: every change the registrar has made is approved."
            : show === "approved"
              ? "No change approved yet in this semester."
              : "The registrar has not changed any of our sections' classes this semester."}
        </p>
      ) : null}

      {shown.map((section) => (
        <SectionDiff
          key={section.key}
          section={section}
          span={span}
          approval={approvals.get(section.key)}
          onApprove={() => approve.mutate(section.key)}
          approving={approve.isPending && approve.variables === section.key}
        >
          <ChangeLists
            termCode={termCode}
            section={section}
            links={linksOf(section.crn)}
            notes={notesOf(section.crn)}
          />
        </SectionDiff>
      ))}

      {stale.length ? <NoLongerMatching termCode={termCode} items={stale} /> : null}
    </div>
  );
}

/**
 * One CRN's changes on the portal, for its record: the same months, lists, links, notes
 * and approval as on the page, so a change can be read and dealt with where the CRN is
 * being looked at — including one approved long ago, which the banner no longer mentions.
 */
export function PortalChanges({ termCode, crn }: { termCode: string; crn: string }) {
  // With the changes we already knew of, so a gap we had cancelled or had covered is shown here too.
  const changed = useQuery({
    queryKey: ["changed-classes", termCode, "known"],
    queryFn: () => fetchChangedClasses(termCode, { known: true }),
    enabled: Boolean(termCode),
    retry: false,
  });
  const notes = useQuery({
    queryKey: ["class-notes", termCode],
    queryFn: () => fetchClassNotes(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const { approvals, approve } = useApprovals();
  const sections = useMemo(() => changed.data ?? [], [changed.data]);
  const span = useMemo(() => spanOf(sections), [sections]);
  const section = sections.find((one) => one.crn === crn);

  if (!termCode) return <p className="text-sm text-[#667085]">No portal term, so the portal has not been asked.</p>;
  if (changed.isPending) return <p className="text-sm text-[#667085]">Reading the changes…</p>;
  if (changed.error) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {(changed.error as Error).message}
      </p>
    );
  }
  if (!section) {
    return (
      <p className="text-sm text-[#667085]">
        Nothing changed. Every class is where the portal had it when this CRN was first seen.
      </p>
    );
  }
  // Only classes we had already cancelled or had covered: nothing for anybody to approve.
  const news = section.news !== false;
  return (
    <SectionDiff
      plain
      section={section}
      span={span}
      approval={news ? approvals.get(section.key) : undefined}
      onApprove={news ? () => approve.mutate(section.key) : undefined}
      approving={approve.isPending}
    >
      {news ? null : (
        <p className="mt-2 rounded-md bg-[#f2f4f7] px-3 py-1.5 text-xs text-[#475467]">
          <SourceMark source="planning" className="mr-1.5" />
          Nothing to approve: every class the registrar removed, you had already cancelled or had covered.
        </p>
      )}
      <ChangeLists
        termCode={termCode}
        section={section}
        links={(notes.data?.links ?? []).filter((link) => link.crn === crn && link.matches)}
        notes={(notes.data?.notes ?? []).filter((note) => note.crn === crn && note.matches)}
      />
    </SectionDiff>
  );
}

/**
 * The classes that went and the classes that arrived, side by side: where a class is
 * linked to the one it was rescheduled into, and where each can carry a note.
 */
function ChangeLists({
  termCode,
  section,
  links,
  notes,
}: {
  termCode: string;
  section: ChangedClasses;
  links: ClassLink[];
  notes: ClassNote[];
}) {
  const client = useQueryClient();
  // The class that went, while somebody is choosing what it was rescheduled into.
  const [linking, setLinking] = useState<ClassSlot | null>(null);
  const [failed, setFailed] = useState("");
  const refresh = () => {
    setFailed("");
    void client.invalidateQueries({ queryKey: ["class-notes", termCode] });
  };
  const link = useMutation({
    mutationFn: (arrived: ClassSlot) => linkClasses(termCode, { crn: section.crn, gone: linking as ClassSlot, arrived }),
    onSuccess: () => {
      setLinking(null);
      refresh();
    },
    onError: (error: Error) => setFailed(error.message),
  });
  const unlink = useMutation({ mutationFn: unlinkClasses, onSuccess: refresh, onError: (error: Error) => setFailed(error.message) });
  const keyOf = (cls: ClassSlot) => classKey(termCode, section.crn, cls);
  const linkFrom = new Map(links.map((one) => [keyOf(one.from), one]));
  const linkTo = new Map(links.map((one) => [keyOf(one.to), one]));
  const noteOn = (side: "removed" | "added", cls: ClassSlot) =>
    notes.find((one) => one.side === side && keyOf(one.class) === keyOf(cls));

  return (
    <div className="mt-3 border-t border-[#eef1f5] pt-3">
      {linking ? (
        <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#1f4e79]">
          <Link2 size={15} aria-hidden="true" /> Choose the class that {slotSaid(linking)} was rescheduled into.
          <button type="button" onClick={() => setLinking(null)} className="ml-auto text-xs font-semibold underline">
            Cancel
          </button>
        </p>
      ) : null}
      {/* What went beside what arrived, so a class and the one it became sit level with each other. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#842029]">
            Went ({section.removed.length})
            <SourceMark source="portal" />
          </p>
          <ul className="mt-1 grid gap-1.5">
            {section.removed.map((cls) => {
              const linked = linkFrom.get(keyOf(cls));
              return (
                <ClassRow
                  key={keyOf(cls)}
                  cls={cls}
                  tone="text-[#842029]"
                  aside={oursSaid(cls)}
                  note={noteOn("removed", cls)}
                  onNote={(words) => noteClass(termCode, { crn: section.crn, side: "removed", cls, note: words })}
                  onNoted={refresh}
                >
                  {linked ? (
                    <span className="inline-flex items-center gap-1 rounded bg-[#eaf1f8] px-1.5 py-0.5 text-xs font-semibold text-[#1f4e79]">
                      <SourceMark source="planning" className="" />
                      <ArrowRight size={12} aria-hidden="true" /> {slotSaid(linked.to)}
                      <button
                        type="button"
                        onClick={() => unlink.mutate(linked.id)}
                        aria-label={`Unlink ${slotSaid(cls)} from ${slotSaid(linked.to)}`}
                        title={`Linked by ${linked.byName || linked.byEmail}. Unlink`}
                        className="ml-0.5 rounded p-0.5 hover:bg-white"
                      >
                        <Unlink size={11} />
                      </button>
                    </span>
                  ) : section.added.length ? (
                    <button
                      type="button"
                      onClick={() => setLinking(linking && keyOf(linking) === keyOf(cls) ? null : cls)}
                      aria-pressed={Boolean(linking && keyOf(linking) === keyOf(cls))}
                      /*
                       * Shown when the class is pointed at, or while it is the one being
                       * linked: four of them on every card were noise. Where nothing can
                       * hover — a phone — it stays shown.
                       */
                      className={`inline-flex items-center gap-1 rounded border border-[#b7bec8] px-1.5 py-0.5 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${
                        linking && keyOf(linking) === keyOf(cls) ? "" : "[@media(hover:hover)]:opacity-0"
                      }`}
                    >
                      <Link2 size={12} aria-hidden="true" /> Rescheduled to…
                    </button>
                  ) : null}
                </ClassRow>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0f5132]">
            Arrived ({section.added.length})
            <SourceMark source="portal" />
          </p>
          {section.added.length ? (
            <ul className="mt-1 grid gap-1.5">
              {section.added.map((cls) => {
                const linked = linkTo.get(keyOf(cls));
                return (
                  <ClassRow
                    key={keyOf(cls)}
                    cls={cls}
                    tone="text-[#0f5132]"
                    note={noteOn("added", cls)}
                    onNote={(words) => noteClass(termCode, { crn: section.crn, side: "added", cls, note: words })}
                    onNoted={refresh}
                  >
                    {linking ? (
                      <button
                        type="button"
                        onClick={() => link.mutate(cls)}
                        disabled={link.isPending}
                        className="inline-flex items-center gap-1 rounded bg-[#1f4e79] px-1.5 py-0.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Rescheduled into this
                      </button>
                    ) : linked ? (
                      <span className="inline-flex items-center gap-1 rounded bg-[#eaf1f8] px-1.5 py-0.5 text-xs font-semibold text-[#1f4e79]">
                        <SourceMark source="planning" className="" />
                        from {slotSaid(linked.from)}
                      </span>
                    ) : null}
                  </ClassRow>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-[#98a2b3]">Nothing arrived.</p>
          )}
        </div>
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-[#a6292f]">
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/** One class that went or arrived: when, how long, where, its link, and its note. */
function ClassRow({
  cls,
  tone,
  aside = "",
  note,
  onNote,
  onNoted,
  children,
}: {
  cls: ClassSlot & { room?: string };
  tone: string;
  aside?: string;
  note?: ClassNote;
  onNote: (words: string) => Promise<unknown>;
  onNoted: () => void;
  children?: React.ReactNode;
}) {
  const [writing, setWriting] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (words: string) => onNote(words),
    onSuccess: () => {
      setWriting(null);
      onNoted();
    },
  });
  const hours = Math.round((minutesOf({ ...cls, room: cls.room ?? "" }) / 60) * 100) / 100;
  return (
    <li className="group rounded-md border border-[#eef1f5] px-2.5 py-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-semibold tabular-nums ${tone}`}>{slotSaid(cls)}</span>
        <span className="tabular-nums text-[#667085]">{hours} h</span>
        {cls.room ? <span className="text-[#344054]">{formatRoom(cls.room)}</span> : null}
        {aside ? <span className="text-xs text-[#98a2b3]">{aside}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {children}
          <button
            type="button"
            onClick={() => setWriting(writing === null ? (note?.note ?? "") : null)}
            aria-label={`${note ? "Edit the note on" : "Add a note to"} ${slotSaid(cls)}`}
            title={note ? "Edit the note" : "Add a note"}
            className="rounded p-1 text-[#667085] hover:bg-[#f2f4f7]"
          >
            <MessageSquare size={14} />
          </button>
        </span>
      </div>
      {note && writing === null ? (
        <p className="mt-1 text-xs text-[#475467]">
          <SourceMark source="planning" className="mr-1.5" />
          {note.note} <span className="text-[#98a2b3]">— {note.byName || note.byEmail}</span>
        </p>
      ) : null}
      {writing !== null ? (
        <form
          className="mt-1.5 flex items-start gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(writing);
          }}
        >
          <input
            autoFocus
            value={writing}
            maxLength={400}
            onChange={(event) => setWriting(event.target.value)}
            placeholder="What happened to this class"
            aria-label={`Note on ${slotSaid(cls)}`}
            className="h-8 min-w-0 flex-1 rounded-md border border-[#d0d5dd] px-2 text-sm"
          />
          <button
            type="submit"
            disabled={save.isPending}
            className="h-8 rounded-md bg-[#1f4e79] px-2.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : writing.trim() ? "Save" : "Remove"}
          </button>
          <button
            type="button"
            onClick={() => setWriting(null)}
            aria-label="Cancel"
            className="h-8 rounded-md px-1.5 text-[#667085] hover:bg-[#f2f4f7]"
          >
            <X size={14} />
          </button>
        </form>
      ) : null}
    </li>
  );
}

/**
 * Links and notes the registrar has since overtaken: a gone class put back, an arrived one
 * taken away. Kept rather than lost, because somebody wrote them for a reason.
 */
function NoLongerMatching({ termCode, items }: { termCode: string; items: (ClassLink | ClassNote)[] }) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ["class-notes", termCode] });
  const unlink = useMutation({ mutationFn: unlinkClasses, onSuccess: refresh });
  const clear = useMutation({
    mutationFn: (note: ClassNote) => noteClass(termCode, { crn: note.crn, side: note.side, cls: note.class, note: "" }),
    onSuccess: refresh,
  });
  return (
    <section className="rounded-lg border border-[#e4e8ef] bg-[#f8fafc] p-4">
      <h4 className="text-sm font-semibold text-[#344054]">
        No longer matching the timetable
        <SourceMark source="planning" />
      </h4>
      <p className="mt-0.5 text-xs text-[#667085]">
        The registrar has since put back a class that went, or taken away one that arrived. Kept so nothing anybody wrote
        is lost.
      </p>
      <ul className="mt-2 grid gap-1.5 text-sm">
        {items.map((item) =>
          "from" in item ? (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="text-[#344054]">
                CRN {item.crn}: {slotSaid(item.from)} → {slotSaid(item.to)}
                {item.note ? ` · ${item.note}` : ""}
              </span>
              <span className="text-xs text-[#98a2b3]">{item.byName || item.byEmail}</span>
              <button type="button" onClick={() => unlink.mutate(item.id)} className="ml-auto text-xs text-[#a6292f] underline">
                Remove
              </button>
            </li>
          ) : (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="text-[#344054]">
                CRN {item.crn}, {slotSaid(item.class)}: {item.note}
              </span>
              <span className="text-xs text-[#98a2b3]">{item.byName || item.byEmail}</span>
              <button type="button" onClick={() => clear.mutate(item)} className="ml-auto text-xs text-[#a6292f] underline">
                Remove
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
