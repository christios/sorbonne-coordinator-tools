import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Pencil, Shield, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ChecksPanel } from "@/components/ChecksPanel";
import { ExemptionReasonsPanel } from "@/components/ExemptionReasonsPanel";
import { ProgrammeCodesPanel } from "@/components/ProgrammeCodesPanel";
import { TermWeeksPanel } from "@/components/TermWeeksPanel";
import { ThisBrowser } from "@/components/ThisBrowser";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoTip } from "@/components/InfoTip";
import { COORDINATOR_APPS, type AppId } from "@/routes/apps";
import type { SettingsSection } from "@/routes/toolRoute";
import { sectionFrom, sectionsFor } from "@/services/settingsSections";
import { useStaffUser } from "@/components/useStaffUser";
import {
  type ApiToken,
  AppAccess,
  AppRole,
  CoordinatorAccount,
  type Owner,
  createApiToken,
  fetchApiTokens,
  fetchStaffList,
  inviteCoordinator,
  removeCoordinator,
  revokeApiToken,
  updateCoordinator,
} from "@/services/staffDirectory";

/**
 * Settings for the application itself: who may sign in, the tokens a coordinator makes so
 * a program can act as them, and the checks that decide what everybody is warned about.
 * The people named in COORDINATOR_ACCESS_EMAILS are shown but not editable — they are the
 * way back in if the list is ever emptied.
 *
 * Each page has its own entry in the account menu and its own address, so the menu says
 * what is here rather than hiding two pages behind the first one's name, and a link to the
 * checks opens the checks. A coordinator who is not an administrator is offered only what
 * they may use: the checks, to read.
 */
export function StaffSettings() {
  const user = useStaffUser();
  const isAdmin = Boolean(user?.isAdmin);
  const offered = sectionsFor(isAdmin);
  const [page, setPage] = useState<SettingsSection>(() => sectionFrom(window.location.hash, isAdmin));
  useEffect(() => {
    const follow = () => setPage(sectionFrom(window.location.hash, isAdmin));
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [isAdmin]);
  const open = (next: SettingsSection) => {
    window.history.replaceState(null, "", `#/settings/${next}`);
    setPage(next);
  };
  const tab = (active: boolean) =>
    `-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${
      active ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:text-[#1f4e79]"
    }`;

  return (
    <div className="w-full page-gutters [--page-cap:70rem] [--page-pad:1rem] sm:[--page-pad:1.5rem] lg:[--page-pad:2rem] py-2">
      {/* No line under the title: the tabs below already say what Settings holds. */}
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-[#171717]">Settings</h2>
      </header>

      {/* One page on offer needs no tabs to choose between. */}
      {offered.length > 1 ? (
        <nav className="mt-6 flex gap-1 border-b border-[#d9dee7]">
          {offered.map(({ section, label, Icon }) => (
            <button key={section} type="button" onClick={() => open(section)} className={tab(page === section)}>
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
      ) : null}

      {page === "users" ? (
        <StaffDirectory />
      ) : page === "tokens" ? (
        <ApiTokens />
      ) : page === "programme-codes" ? (
        <AppProgrammeCodes />
      ) : page === "exemption-reasons" ? (
        <AppExemptionReasons />
      ) : page === "semesters" ? (
        <AppSemesters />
      ) : page === "this-browser" ? (
        <ThisBrowser />
      ) : (
        <AppChecks />
      )}
    </div>
  );
}

/**
 * A settings page's own small heading, with what used to be its opening paragraph one hover
 * away: the paragraph is wanted the first time, and is a line of grey every time after.
 */
function PageHeading({ title, about, children }: { title: string; about: string; children: ReactNode }) {
  return (
    <h3 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-[#344054]">
      {title}
      <InfoTip label={about}>{children}</InfoTip>
    </h3>
  );
}

/**
 * Every check the department runs, in one place, and an administrator's to change.
 *
 * Switching a check off hides a warning from every coordinator, so it is decided once,
 * here, by somebody entitled to decide it for everybody. Everybody else can read it.
 */
function AppChecks() {
  const user = useStaffUser();
  return (
    <section className="mt-6 max-w-2xl">
      <PageHeading title="Warnings the application raises" about="How the checks work">
        Each check can be switched off, or told how big a thing has to be before it warns. They apply to the whole
        department and save as you change them.
      </PageHeading>
      <ChecksPanel canChange={Boolean(user?.isAdmin)} />
    </section>
  );
}

/** The reasons the Exempt button offers, and the tables filter on. */
function AppExemptionReasons() {
  const user = useStaffUser();
  return (
    <section className="mt-6 max-w-2xl">
      <PageHeading title="Reasons the Exempt button offers" about="How exemption reasons are used">
        Picked rather than typed, so the Students and Cohorts tables can be filtered on them. Taking a reason off the
        list changes nothing already recorded.
      </PageHeading>
      <ExemptionReasonsPanel canChange={Boolean(user?.isAdmin)} />
    </section>
  );
}

/**
 * Which programme codes are the same students, for everybody at once.
 *
 * Admissions recodes a programme now and then — L2's MATH became MATS — and every group
 * row, cohort and check written in the old code stops matching. Said here once, it holds
 * everywhere. An administrator's to change, since it moves who can be placed where.
 */
function AppProgrammeCodes() {
  const user = useStaffUser();
  return (
    <section className="mt-6 max-w-2xl">
      <PageHeading title="Codes that mean the same programme" about="What a programme code line does">
        When admissions gives a programme a new code, say here which code it means. Every group, cohort and check then
        treats the two as the same students.
      </PageHeading>
      <ProgrammeCodesPanel canChange={Boolean(user?.isAdmin)} />
    </section>
  );
}

/**
 * Where each semester's Week 1 is, which the semester timetable counts its weeks from.
 * An administrator's to set, since it changes the week numbers everybody sees.
 */
function AppSemesters() {
  const user = useStaffUser();
  return (
    <section className="mt-6 max-w-2xl">
      <PageHeading title="Week 1 of each semester" about="What Week 1 is used for">
        The semester timetable numbers its weeks from the first teaching week, and lets you jump straight to any of
        them. Any day of that week will do.
      </PageHeading>
      <TermWeeksPanel canChange={Boolean(user?.isAdmin)} />
    </section>
  );
}

/**
 * Tokens for programs.
 *
 * A coordinator at a keyboard is carried by the Google sign-in cookie, which a script
 * cannot hold: it is HttpOnly, so nothing outside the browser can read it. A token is
 * the way in for a script, and it carries the identity of whoever made it and no more —
 * lose your access here and your tokens lose it with you.
 *
 * The token is shown once, on the screen that makes it. Afterwards only its first
 * characters are known, which is enough to tell two apart and not enough to use.
 */
function ApiTokens() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: fetchApiTokens });
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [made, setMade] = useState<{ token: string; record: ApiToken } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiToken | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
  const create = useMutation({
    mutationFn: () => createApiToken({ name: name.trim(), days }),
    onSuccess: (result) => {
      setMade(result);
      setCopied(false);
      setName("");
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (token: ApiToken) => revokeApiToken(token.id),
    onSuccess: () => {
      setPendingRevoke(null);
      refresh();
    },
  });

  const live = (token: ApiToken) => !token.revokedAt && (!token.expiresAt || token.expiresAt > new Date().toISOString());
  const day = (value: string) => (value ? value.slice(0, 10) : "—");

  return (
    <section className="mt-6 space-y-5">
      <PageHeading title="Tokens for scripts" about="What a token is">
        A token lets a program call this application as you, with the same access. Send it as an{" "}
        <code className="rounded bg-[#f2f4f7] px-1">Authorization: Bearer</code> header.
      </PageHeading>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[#e5e9f0] bg-[#f8fafc] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label className="text-sm font-semibold text-[#344054]">
          What it is for
          <input
            aria-label="Token name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Timetable data load"
            className="mt-1.5 block w-64 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-[#344054]">
          Lasts
          <select
            aria-label="How long the token lasts"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="mt-1.5 block rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>a year</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
        >
          {create.isPending ? "Making…" : "Make a token"}
        </button>
        {create.error ? (
          <p role="alert" className="basis-full text-sm text-[#a6292f]">{(create.error as Error).message}</p>
        ) : null}
      </form>

      {made ? (
        <div className="rounded-lg border border-[#bfdcc6] bg-[#f4faf5] p-4">
          {/* The warning stays on screen, where the token is: it is the one moment it matters. */}
          <p className="text-sm font-semibold text-[#2f6b3d]">
            Copy {made.record.name} now — this is the only time it is shown. Keep it as you would a password: anyone
            holding it can do what you can, until it expires or you revoke it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-[#bfdcc6] bg-white px-3 py-2 font-mono text-xs text-[#171717]">
              {made.token}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(made.token);
                setCopied(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]"
            >
              <Copy size={14} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={() => setMade(null)} className="text-sm font-semibold text-[#667085]">
              Done
            </button>
          </div>
        </div>
      ) : null}

      {tokens.isLoading ? (
        <p className="inline-flex items-center gap-2 text-sm text-[#667085]">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading tokens…
        </p>
      ) : tokens.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(tokens.error as Error).message}</p>
      ) : (tokens.data ?? []).length === 0 ? (
        <p className="text-sm text-[#667085]">No tokens yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              <th className="py-2 pr-4 font-semibold">Name</th>
              <th className="py-2 pr-4 font-semibold">Token</th>
              <th className="py-2 pr-4 font-semibold">Whose</th>
              <th className="py-2 pr-4 font-semibold">Made</th>
              <th className="py-2 pr-4 font-semibold">Expires</th>
              <th className="py-2 pr-4 font-semibold">Last used</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {(tokens.data ?? []).map((token) => (
              <tr key={token.id} className={`border-t border-[#e4e8ef] ${live(token) ? "" : "text-[#98a2b3]"}`}>
                <td className="py-2.5 pr-4 font-semibold text-[#171717]">{token.name}</td>
                <td className="py-2.5 pr-4 font-mono text-xs">{token.prefix}…</td>
                <td className="py-2.5 pr-4">{token.email}</td>
                <td className="py-2.5 pr-4 tabular-nums">{day(token.createdAt)}</td>
                <td className="py-2.5 pr-4 tabular-nums">{day(token.expiresAt)}</td>
                <td className="py-2.5 pr-4 tabular-nums">{day(token.lastUsedAt)}</td>
                <td className="py-2.5 text-right">
                  {token.revokedAt ? (
                    <span className="text-xs">Revoked {day(token.revokedAt)}</span>
                  ) : !live(token) ? (
                    <span className="text-xs">Expired</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingRevoke(token)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#e5b7b9] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                    >
                      <Trash2 size={13} aria-hidden="true" /> Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke this token?"
        description={
          pendingRevoke
            ? `Anything using ${pendingRevoke.name} stops working at once. This cannot be undone; make another if you need one.`
            : ""
        }
        confirmLabel="Revoke"
        onConfirm={() => pendingRevoke && revoke.mutate(pendingRevoke)}
        onClose={() => setPendingRevoke(null)}
      />
    </section>
  );
}

function StaffDirectory() {
  const me = useStaffUser();
  const queryClient = useQueryClient();
  // Nobody but an administrator may read the staff list, so nobody else asks for it.
  const staff = useQuery({
    queryKey: ["staff-list"],
    queryFn: fetchStaffList,
    enabled: me?.isAdmin !== false,
  });

  const [email, setEmail] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<CoordinatorAccount | null>(null);
  // Nothing by default: access is given deliberately rather than assumed from an invitation.
  const [inviteApps, setInviteApps] = useState<AppAccess>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-list"] });

  const invite = useMutation({
    mutationFn: () => inviteCoordinator({ email: email.trim(), isAdmin: asAdmin, apps: inviteApps }),
    onSuccess: () => {
      setEmail("");
      setInviteApps({});
      setAsAdmin(false);
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ account, patch }: { account: CoordinatorAccount; patch: { isAdmin?: boolean; isActive?: boolean; displayName?: string; apps?: AppAccess } }) =>
      updateCoordinator(account.email, patch),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (account: CoordinatorAccount) => removeCoordinator(account.email),
    onSuccess: () => {
      setPendingRemoval(null);
      refresh();
    },
  });

  const error = staff.error?.message ?? invite.error?.message ?? update.error?.message ?? remove.error?.message;

  if (me && !me.isAdmin) {
    return (
      <p className="mt-8 rounded-lg border border-[#d9dee7] bg-white px-6 py-10 text-center text-sm text-[#667085]">
        Only an administrator can manage who may sign in.
      </p>
    );
  }

  return (
    <section className="mt-6 space-y-5">
      <form
        className="rounded-lg border border-[#d9dee7] bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) invite.mutate();
        }}
      >
        <div className="flex items-center gap-1.5">
          <label htmlFor="invite-email" className="text-sm font-semibold text-[#344054]">
            Invite a colleague
          </label>
          <InfoTip label="How an invited colleague signs in">
            They sign in with the Google account for this address; nobody else can get in.
          </InfoTip>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="colleague@sorbonne.ae"
            className="min-w-64 flex-1 rounded-md border border-[#c8d0db] px-3 py-2 text-sm text-[#1f2937] outline-none placeholder:text-[#7d8796] focus:border-[#1f4e79] focus:ring-3 focus:ring-[#dceaf6]"
          />
          <label className="inline-flex select-none items-center gap-2 text-sm text-[#344054]">
            <input type="checkbox" checked={asAdmin} onChange={(event) => setAsAdmin(event.target.checked)} />
            Administrator
          </label>
          <button
            type="submit"
            disabled={invite.isPending || email.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
          >
            {invite.isPending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus size={16} aria-hidden="true" />
            )}
            Invite
          </button>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-sm text-[#667085]">
          <span id="invite-apps-hint">Apps they may open</span>
          <InfoTip label="What No access means">
            An app left at <span className="font-semibold">No access</span> is one they will not see at all.
          </InfoTip>
        </p>
        <div className="mt-2">
          <AppAccessEditor value={inviteApps} onChange={setInviteApps} describedBy="invite-apps-hint" />
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[#d9dee7] bg-white">
        {staff.isLoading ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-[#667085]">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading the staff list…
          </p>
        ) : null}

        {(staff.data?.accounts ?? []).map((account) => (
          <AccountRow
            key={account.email}
            account={account}
            busy={update.isPending || remove.isPending}
            onToggleAdmin={() => update.mutate({ account, patch: { isAdmin: !account.isAdmin } })}
            onToggleActive={() => update.mutate({ account, patch: { isActive: !account.isActive } })}
            onRename={(displayName) => update.mutate({ account, patch: { displayName } })}
            onRemove={() => setPendingRemoval(account)}
            onChangeApps={(apps) => update.mutate({ account, patch: { apps } })}
          />
        ))}

        {staff.data && staff.data.accounts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#667085]">
            Nobody has been invited yet. Only the owners below can sign in.
          </p>
        ) : null}
      </div>

      {staff.data && staff.data.owners.length > 0 ? (
        <section className="rounded-lg border border-[#e5e9f0] bg-[#f8fafc] p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">
            Owners
            <InfoTip label="Who the owners are">
              Always administrators, set with{" "}
              <code className="rounded bg-[#f2f4f7] px-1 py-0.5">COORDINATOR_ACCESS_EMAILS</code>. Their access is
              changed there rather than here — their name can be set here.
            </InfoTip>
          </h3>
          <ul className="mt-2 space-y-1">
            {staff.data.owners.map((owner) => (
              <li key={owner.email}>
                <OwnerRow
                  owner={owner}
                  busy={update.isPending}
                  onRename={(displayName) =>
                    update.mutate({
                      account: { email: owner.email } as CoordinatorAccount,
                      patch: { displayName },
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove this account?"
        description={`${pendingRemoval?.email ?? ""} will lose access to Coordinator Tools straight away. You can invite them again later.`}
        confirmLabel="Remove"
        onConfirm={() => pendingRemoval && remove.mutate(pendingRemoval)}
        onClose={() => setPendingRemoval(null)}
      />
    </section>
  );
}

/**
 * An owner: named here, admitted elsewhere.
 *
 * Deliberately not an AccountRow — there is nothing to promote, suspend or remove, and
 * offering those controls would suggest this screen governs their access when it does not.
 */
function OwnerRow({
  owner,
  busy,
  onRename,
}: {
  owner: Owner;
  busy: boolean;
  onRename: (displayName: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const named = owner.name && owner.name !== owner.email;
  const [draft, setDraft] = useState(named ? owner.name : "");

  if (renaming) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 rounded-md border border-[#d9dee7] bg-white px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onRename(draft.trim());
          setRenaming(false);
        }}
      >
        <input
          autoFocus
          aria-label={`Name for ${owner.email}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={owner.email}
          className="w-56 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f2f7fb] disabled:opacity-50"
        >
          Save name
        </button>
        <button type="button" onClick={() => setRenaming(false)} className="text-xs text-[#667085] underline">
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#d9dee7] bg-white px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-[#344054]">
        {named ? <span className="font-semibold text-[#171717]">{owner.name}</span> : null}
        {named ? <span className="ml-2 text-xs text-[#667085]">{owner.email}</span> : owner.email}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setDraft(named ? owner.name : "");
          setRenaming(true);
        }}
        className="rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f2f7fb] disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-1.5">
          <Pencil size={14} aria-hidden="true" /> Name
        </span>
      </button>
    </div>
  );
}

/**
 * Which apps somebody may open, and what they may do in each.
 *
 * Three states per app rather than two, because "no access" and "access" are not the whole
 * story: whoever maintains the syllabus catalogue is doing something different from whoever
 * writes a syllabus in it, and that difference lives here rather than in a platform-wide flag.
 */
function AppAccessEditor({
  value,
  onChange,
  disabled = false,
  describedBy,
}: {
  value: AppAccess;
  onChange: (value: AppAccess) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const set = (app: AppId, role: AppRole | undefined) => {
    const next = { ...value };
    if (role) next[app] = role;
    else delete next[app];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
      {COORDINATOR_APPS.map((app) => {
        const role = value[app.id];
        return (
          <fieldset
            key={app.id}
            className={`rounded-md border px-2 py-1.5 ${role ? "border-[#c7dcef] bg-[#f4f8fc]" : "border-[#e3e7ee] bg-white"}`}
          >
            <legend className="px-1 text-[11px] font-semibold text-[#667085]">{app.name}</legend>
            <div className="flex gap-0.5">
              {([
                ["none", "No access", undefined],
                ["member", "Member", "member"],
                ["admin", "Admin", "admin"],
              ] as const).map(([key, label, wanted]) => (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  aria-pressed={(role ?? undefined) === wanted}
                  onClick={() => set(app.id, wanted)}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ${
                    (role ?? undefined) === wanted
                      ? "bg-[#1f4e79] text-white"
                      : "text-[#1f4e79] hover:bg-[#eaf1f8]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function AccountRow({
  account,
  busy,
  onToggleAdmin,
  onToggleActive,
  onRename,
  onRemove,
  onChangeApps,
}: {
  account: CoordinatorAccount;
  busy: boolean;
  onToggleAdmin: () => void;
  onToggleActive: () => void;
  onRename: (displayName: string) => void;
  onRemove: () => void;
  onChangeApps: (apps: AppAccess) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(account.displayName ?? "");
  const actionClass =
    "rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f2f7fb] disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#edf0f4] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(draft.trim());
              setRenaming(false);
            }}
          >
            <input
              autoFocus
              aria-label={`Name for ${account.email}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={account.email}
              className="w-56 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm"
            />
            <button type="submit" disabled={busy} className={actionClass}>
              Save name
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(account.displayName ?? "");
                setRenaming(false);
              }}
              className="text-xs text-[#667085] underline"
            >
              Cancel
            </button>
          </form>
        ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-[#171717]">{account.name || account.email}</span>
          {account.isAdmin ? <Badge tone="admin">Administrator</Badge> : null}
          {account.isActive ? null : <Badge tone="warning">Suspended</Badge>}
          {account.lastSeenAt ? null : <Badge tone="quiet">Not signed in yet</Badge>}
        </div>
        )}
        <p className="mt-0.5 truncate text-xs text-[#667085]">
          {account.name ? `${account.email} · ` : ""}
          {account.lastSeenAt ? `last signed in ${formatDay(account.lastSeenAt)}` : `invited ${formatDay(account.createdAt)}`}
        </p>
      </div>

      <div className="order-last w-full">
        {account.isAdmin ? (
          <p className="flex items-center gap-1 text-xs text-[#667085]">
            Opens every app
            <InfoTip label="Why an administrator opens every app">
              An administrator hands out access, and cannot be shut out of what they hand out.
            </InfoTip>
          </p>
        ) : (
          <AppAccessEditor value={account.apps ?? {}} onChange={onChangeApps} disabled={busy} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onToggleAdmin} className={actionClass}>
          {account.isAdmin ? (
            <span className="inline-flex items-center gap-1.5">
              <Shield size={14} aria-hidden="true" /> Revoke admin
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={14} aria-hidden="true" /> Make admin
            </span>
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(account.displayName ?? "");
            setRenaming(true);
          }}
          className={actionClass}
        >
          <span className="inline-flex items-center gap-1.5">
            <Pencil size={14} aria-hidden="true" /> Name
          </span>
        </button>
        <button type="button" disabled={busy} onClick={onToggleActive} className={actionClass}>
          {account.isActive ? "Suspend" : "Restore"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${account.email}`}
          className="rounded-md border border-[#efc9cb] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#a6292f] hover:bg-[#fff5f5] disabled:opacity-50"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "admin" | "warning" | "quiet"; children: string }) {
  const tones = {
    admin: "border-[#c7dcef] bg-[#eaf1f8] text-[#1f4e79]",
    warning: "border-[#efc9cb] bg-[#fff5f5] text-[#8f1f25]",
    quiet: "border-[#e3e7ee] bg-[#f5f7fa] text-[#667085]",
  } as const;
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function formatDay(timestamp: string): string {
  const moment = new Date(timestamp);
  if (Number.isNaN(moment.getTime())) return timestamp;
  return moment.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
