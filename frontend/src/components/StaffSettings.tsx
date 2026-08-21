import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStaffUser } from "@/components/useStaffUser";
import {
  CoordinatorAccount,
  fetchStaffList,
  inviteCoordinator,
  removeCoordinator,
  updateCoordinator,
} from "@/services/staffDirectory";

/**
 * Settings for the application itself. Users is the only page so far, and it is
 * where the staff list is kept: invite a colleague, promote them, suspend them,
 * or remove them. The people named in COORDINATOR_ACCESS_EMAILS are shown but not
 * editable — they are the way back in if this list is ever emptied by mistake.
 */
export function StaffSettings() {
  return (
    <div className="mx-auto max-w-[70rem] px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-[#171717]">Settings</h2>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          Who can sign in to Academic Coordinator Tools, and what they may do here.
        </p>
      </header>

      <nav className="mt-6 flex gap-1 border-b border-[#d9dee7]">
        <span className="-mb-px inline-flex items-center gap-2 border-b-2 border-[#1f4e79] px-3 py-2 text-sm font-semibold text-[#1f4e79]">
          <Users size={15} aria-hidden="true" /> Users
        </span>
      </nav>

      <StaffDirectory />
    </div>
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
    mutationFn: ({ account, patch }: { account: CoordinatorAccount; patch: { isAdmin?: boolean; isActive?: boolean } }) =>
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
            <code className="rounded bg-white px-1 py-0.5 text-[13px]">COORDINATOR_ACCESS_EMAILS</code> and changed
            there rather than here.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {staff.data.owners.map((owner) => (
              <li key={owner} className="rounded-full border border-[#d9dee7] bg-white px-3 py-1 text-xs text-[#344054]">
                {owner}
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

function AccountRow({
  account,
  busy,
  onToggleAdmin,
  onToggleActive,
  onRemove,
}: {
  account: CoordinatorAccount;
  busy: boolean;
  onToggleAdmin: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
}) {
  const actionClass =
    "rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f2f7fb] disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#edf0f4] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-[#171717]">{account.name || account.email}</span>
          {account.isAdmin ? <Badge tone="admin">Administrator</Badge> : null}
          {account.isActive ? null : <Badge tone="warning">Suspended</Badge>}
          {account.lastSeenAt ? null : <Badge tone="quiet">Not signed in yet</Badge>}
        </div>
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
