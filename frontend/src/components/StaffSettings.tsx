import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Pencil, Shield, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStaffUser } from "@/components/useStaffUser";
import {
  type ApiToken,
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
 * Settings for the application itself: who may sign in, and the tokens a coordinator
 * makes so a program can act as them. The people named in COORDINATOR_ACCESS_EMAILS are
 * shown but not editable — they are the way back in if the list is ever emptied.
 */
export function StaffSettings() {
  const [page, setPage] = useState<"users" | "tokens">("users");
  const tab = (active: boolean) =>
    `-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${
      active ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:text-[#1f4e79]"
    }`;

  return (
    <div className="mx-auto max-w-[70rem] px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-[#171717]">Settings</h2>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          Who can sign in to Academic Coordinator Tools, and what they may do here.
        </p>
      </header>

      <nav className="mt-6 flex gap-1 border-b border-[#d9dee7]">
        <button type="button" onClick={() => setPage("users")} className={tab(page === "users")}>
          <Users size={15} aria-hidden="true" /> Users
        </button>
        <button type="button" onClick={() => setPage("tokens")} className={tab(page === "tokens")}>
          <KeyRound size={15} aria-hidden="true" /> API tokens
        </button>
      </nav>

      {page === "users" ? <StaffDirectory /> : <ApiTokens />}
    </div>
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
      <p className="max-w-2xl text-sm leading-6 text-[#667085]">
        A token lets a program call this application as you — the same access, from a script or a terminal. Send it as
        an <code className="rounded bg-[#f2f4f7] px-1">Authorization: Bearer</code> header. Keep it as you would a
        password: anyone holding it can do what you can do, until it expires or you revoke it.
      </p>

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
          <p className="text-sm font-semibold text-[#2f6b3d]">
            Copy {made.record.name} now — this is the only time it is shown.
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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-list"] });

  const invite = useMutation({
    mutationFn: () => inviteCoordinator({ email: email.trim(), isAdmin: asAdmin }),
    onSuccess: () => {
      setEmail("");
      setAsAdmin(false);
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ account, patch }: { account: CoordinatorAccount; patch: { isAdmin?: boolean; isActive?: boolean; displayName?: string } }) =>
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
        <label htmlFor="invite-email" className="block text-sm font-semibold text-[#344054]">
          Invite a colleague
        </label>
        <p className="mt-1 text-sm text-[#667085]">
          They sign in with the Google account for this address; nobody else can get in.
        </p>
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
          <h3 className="text-sm font-semibold text-[#344054]">Owners</h3>
          <p className="mt-1 text-sm leading-6 text-[#667085]">
            Always administrators, set with{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[13px]">COORDINATOR_ACCESS_EMAILS</code>. Their access
            is changed there rather than here — their name can be set here.
          </p>
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

function AccountRow({
  account,
  busy,
  onToggleAdmin,
  onToggleActive,
  onRename,
  onRemove,
}: {
  account: CoordinatorAccount;
  busy: boolean;
  onToggleAdmin: () => void;
  onToggleActive: () => void;
  onRename: (displayName: string) => void;
  onRemove: () => void;
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
