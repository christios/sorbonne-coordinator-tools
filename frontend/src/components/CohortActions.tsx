import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, Trash2, Users } from "lucide-react";
import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RulesList } from "@/components/DiscrepancyRulesEditor";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { CodesField, CohortExpectationsFields, missingExpectations } from "@/components/CohortExpectations";
import { readingDate } from "@/services/discrepancies";
import { electiveOptions } from "@/services/electiveOptions";
import { rulesDescription, schemaNote, useRuleDrafts } from "@/services/ruleDrafts";
import { fetchPortalCourses, fetchRegistrationCheck } from "@/services/portalLists";
import { fetchSchema } from "@/services/scenRosters";
import { type Cohort, type TeamsCheck, deleteCohort, fetchTeamsCheck, updateCohort } from "@/services/studentDatabase";

/**
 * One line on what the roster sync's last reading makes of the cohort's channel, or nothing
 * when there is nothing to say — no channel saved, or the answer not in yet.
 */
function teamsStatus(check: TeamsCheck | undefined, members: number): string {
  if (!check) return "";
  if (check.reason === "never_synced") return "The roster sync has not reported yet";
  if (check.reason === "channel_not_in_sync") return `The roster sync's last reading has no channel called ${check.channel}`;
  if (!check.known) return "";
  const at = check.syncedAt ? Date.parse(check.syncedAt) : NaN;
  const when = Number.isNaN(at) ? "Last reading" : `Last reading ${readingDate(at)}`;
  return check.missing.length
    ? `${when}: ${check.missing.length} of ${members} not in it`
    : `${when}: every member is in it`;
}


/**
 * Renaming a cohort, saying what it expects, deleting one, and seeing who is in it.
 *
 * These lived on a Cohorts page of their own, which existed to list four cohorts and let
 * you click one. The list is now the dropdown beside this, so the page was a detour: the
 * things it could actually do belong next to the cohort they act on.
 *
 * What a cohort expects is said in the portal's codes — the majors and the terms it
 * spans, and a year level — chosen from the code tables the extension read from the
 * portal, so "differs from the cohort's" compares like with like.
 */
export function CohortActions({
  cohort,
  onShowMembers,
}: {
  cohort: Cohort;
  /** Left out where the members are already on screen, as on the Cohorts page. */
  onShowMembers?: (cohort: Cohort) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(cohort.name);
  const [term, setTerm] = useState(cohort.term);
  const [majors, setMajors] = useState<string[]>(cohort.majors);
  const [terms, setTerms] = useState<string[]>(cohort.terms);
  const [yearLevel, setYearLevel] = useState(cohort.yearLevel);
  const [workbookTab, setWorkbookTab] = useState(cohort.workbookTab);
  const [firstSemester, setFirstSemester] = useState(String(cohort.firstSemester || ""));
  const [allowedCodes, setAllowedCodes] = useState<string[]>(cohort.allowedCodes);
  const [teamsChannel, setTeamsChannel] = useState(cohort.teamsChannel ?? "");
  const teamsChannelId = useId();
  /*
   * The cohort's settings are two things: what it is and expects, and its own rules on top
   * of the shared ones. The rules had a button of their own beside the table; they are a
   * tab here, and save with the rest when anything in them has changed.
   */
  const [tab, setTab] = useState<"cohort" | "rules">("cohort");
  const scope = { kind: "cohort" as const, cohort };
  const rules = useRuleDrafts(scope, editing);
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: editing, staleTime: 60_000 });
  const portalTerms = useQuery({ queryKey: ["portal", "courses", ""], queryFn: () => fetchPortalCourses("", ""), enabled: editing, retry: false });
  // What this cohort's students are registered in outside their groups — the Cohorts
  // page's own query, so it is usually already in hand.
  const check = useQuery({
    queryKey: ["registration-check", cohort.id],
    queryFn: () => fetchRegistrationCheck(cohort.id),
    enabled: editing,
    retry: false,
  });
  // What the roster sync last made of the channel as saved — the Cohorts page's own query.
  const savedChannel = (cohort.teamsChannel ?? "").trim();
  const teams = useQuery({
    queryKey: ["teams-check", cohort.id],
    queryFn: () => fetchTeamsCheck(cohort.id),
    enabled: editing && Boolean(savedChannel),
    retry: false,
  });
  // Said of the saved channel only: a name being typed has not been compared with anything.
  const teamsLine =
    savedChannel && teamsChannel.trim() === savedChannel ? teamsStatus(teams.data, cohort.memberCount) : "";

  const refresh = () => client.invalidateQueries({ queryKey: ["cohorts"] });
  const save = useMutation({
    mutationFn: async () => {
      await updateCohort(cohort.id, {
        name: name.trim(),
        term: term.trim(),
        notes: cohort.notes,
        majors,
        terms,
        yearLevel: yearLevel.trim(),
        workbookTab: workbookTab.trim(),
        firstSemester: Number(firstSemester) || 0,
        allowedCodes,
        /*
         * Always the field's value, so saving anything else keeps the channel rather than
         * blanking it — except from a cohort read without the field at all, where an
         * untouched empty box is left out and the server keeps what it holds.
         */
        teamsChannel: cohort.teamsChannel === undefined && !teamsChannel.trim() ? undefined : teamsChannel.trim(),
      });
      return rules.changed ? rules.save() : null;
    },
    onSuccess: (savedRules) => {
      if (savedRules) client.setQueryData(["discrepancy-rules"], savedRules);
      setEditing(false);
      refresh();
      /*
       * And the register's verdict on this cohort, which reads what was just saved: the
       * allowed list decides which electives warn, the semesters which terms are checked.
       * Refreshing only the cohort list left the old verdict on screen — SPRT added, and
       * every sport warning still there until the page was reloaded.
       */
      void client.invalidateQueries({ queryKey: ["registration-check", cohort.id] });
      // And who is not in its Teams channel, which reads the channel just saved.
      void client.invalidateQueries({ queryKey: ["teams-check", cohort.id] });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteCohort(cohort.id),
    onSuccess: () => {
      setDeleting(false);
      refresh();
    },
  });

  const missing = missingExpectations({ majors, terms, yearLevel });
  // The courses the portal's list holds this term, and their subjects, as a starting offer.
  const allowedOptions = electiveOptions(
    check.data?.electives ?? [],
    (portalTerms.data?.courses ?? []).map((course) => course.courseCode ?? ""),
  );

  return (
    <>
      <div className="flex items-center gap-1">
        {onShowMembers ? (
          <button
            type="button"
            onClick={() => onShowMembers(cohort)}
            title={`Show the ${cohort.memberCount} students in ${cohort.name}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            <Users size={15} aria-hidden="true" />
            <span className="tabular-nums">{cohort.memberCount}</span>
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`${cohort.name} settings`}
          title={`${cohort.name} settings — what it expects, and its own rules`}
          onClick={() => {
            setTab("cohort");
            setName(cohort.name);
            setTerm(cohort.term);
            setMajors(cohort.majors);
            setTerms(cohort.terms);
            setYearLevel(cohort.yearLevel);
            setWorkbookTab(cohort.workbookTab);
            setFirstSemester(String(cohort.firstSemester || ""));
            setAllowedCodes(cohort.allowedCodes);
            setTeamsChannel(cohort.teamsChannel ?? "");
            setEditing(true);
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#b7bec8] bg-white text-[#344054] hover:bg-[#f8fafc]"
        >
          <Settings size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${cohort.name}`}
          onClick={() => setDeleting(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#e5b7b9] bg-white text-[#a6292f] hover:bg-[#fdf3f3]"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>

      <Modal
        open={editing}
        title={`${cohort.name} settings`}
        description={
          tab === "cohort"
            ? "Its name and year, and what it expects of its students in the portal's own codes. A cohort that expects nothing is judged on status alone."
            : rulesDescription(scope)
        }
        onClose={() => setEditing(false)}
        header={
          <div role="tablist" aria-label="Cohort settings" className="-mb-4 mt-3 flex gap-1">
            {(
              [
                { id: "cohort", label: "Cohort" },
                { id: "rules", label: `Rules · ${rules.drafts.length}` },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                  tab === item.id ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:border-[#b7bec8] hover:text-[#344054]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#98a2b3]">
              {missing.length
                ? `Say the cohort's ${missing.join(", ")} to save it.`
                : rules.changed && !rules.complete
                ? "A rule on the Rules tab is not finished yet."
                : tab === "rules"
                  ? schemaNote(schema.data?.source)
                  : ""}
            </span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setEditing(false)} className="text-sm font-semibold text-[#667085]">
                Cancel
              </button>
              <button
                type="button"
                disabled={!name.trim() || missing.length > 0 || (rules.changed && !rules.complete) || save.isPending}
                onClick={() => save.mutate()}
                className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        }
      >
        {tab === "rules" ? (
          <RulesList scope={scope} drafts={rules.drafts} setDrafts={rules.setDrafts} cohortId={rules.cohortId} open={editing} />
        ) : null}
        <div className={tab === "cohort" ? "space-y-4" : "hidden"}>
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <label className="block text-sm font-semibold text-[#344054]">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Foundation Year"
                className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="block text-sm font-semibold text-[#344054]">
              Year
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="2026-27"
                className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
              />
            </label>
          </div>

          <CohortExpectationsFields
            majors={majors}
            terms={terms}
            yearLevel={yearLevel}
            onMajors={setMajors}
            onTerms={setTerms}
            onYearLevel={setYearLevel}
            enabled={editing}
          />
          <p className="text-xs text-[#98a2b3]">
            Codes come from the portal&apos;s tables as the extension read them, from the pulls this browser holds, and
            from the ones the department has always used. A code not listed can be added under its field.
          </p>

          {/*
            * What the cohort's students may take outside our groups without a word from
            * the register: sport, a language another department teaches. What they should
            * take is never typed here — it is the courses of the cohort's sets — and
            * anything registered beyond both is a warning on the student until a
            * coordinator approves it on their record.
            */}
          <CodesField
            label="Always allowed outside the groups"
            hint="Course codes (ENGL-101) or whole subjects (SPRT). Anything else registered outside their groups warns on the student."
            values={allowedCodes}
            options={allowedOptions}
            placeholder="SPRT, ENGL"
            noun="course"
            onChange={setAllowedCodes}
          />

          {/*
            * What this cohort is called in the timetable workbook.
            *
            * Neither half can be worked out: "Foundation Year for Science" initialises to
            * FYFS rather than FYS, and Licence 2's first semester is called S3 because the
            * workbook numbers across the degree instead of within the year. Left blank, the
            * export falls back to initials and the semester's own number.
            */}
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <label className="block text-sm font-semibold text-[#344054]">
              Timetable workbook tab
              <input
                value={workbookTab}
                onChange={(event) => setWorkbookTab(event.target.value)}
                placeholder="BSc-L2"
                className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
              />
              <span className="mt-1 block text-xs font-normal text-[#98a2b3]">
                The sheet name without the semester. Blank uses the cohort&apos;s initials.
              </span>
            </label>
            <label className="block text-sm font-semibold text-[#344054]">
              Its first semester
              <input
                value={firstSemester}
                inputMode="numeric"
                onChange={(event) => setFirstSemester(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="3"
                className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal tabular-nums"
              />
              <span className="mt-1 block text-xs font-normal text-[#98a2b3]">
                3 for Licence 2, so its sheets are S3 and S4.
              </span>
            </label>
          </div>

          {/* Where these students should be on Teams, held against what the roster sync last saw. */}
          <div>
            <div className="flex items-center gap-1">
              <label htmlFor={teamsChannelId} className="text-sm font-semibold text-[#344054]">
                Teams channel
              </label>
              <InfoTip label="What the Teams channel is for">
                The private channel these students belong in, spelled as Teams spells it. The roster sync&apos;s last
                reading is compared against the cohort&apos;s members.
              </InfoTip>
            </div>
            <input
              id={teamsChannelId}
              value={teamsChannel}
              onChange={(event) => setTeamsChannel(event.target.value)}
              placeholder="L2 Students"
              className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
            />
            {teamsLine ? <p className="mt-1 text-xs text-[#98a2b3]">{teamsLine}</p> : null}
          </div>
        </div>
        {save.error ? (
          <p role="alert" className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {(save.error as Error).message}
          </p>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting}
        title="Delete this cohort?"
        description={`${cohort.name}, its ${cohort.memberCount} member(s) and its ${cohort.scopeCount} group set(s) will be removed, in every semester. The students themselves stay — they simply belong to no cohort. This cannot be undone.`}
        confirmLabel="Delete cohort"
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}
