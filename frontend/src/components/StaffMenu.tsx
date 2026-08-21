import { ChevronsUpDown, LogOut, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useStaffUser } from "@/components/useStaffUser";
import { signOut } from "@/services/auth";

type Props = {
  /** "sidebar" fills the width of the left pane; "header" stays compact beside the title. */
  variant?: "sidebar" | "header";
  onOpenSettings?: () => void;
};

/** Who is signed in, and everything that belongs to them: settings and the way out. */
export function StaffMenu({ variant = "header", onOpenSettings }: Props) {
  const user = useStaffUser();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeWhenOutside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  if (!user) return null;

  const inSidebar = variant === "sidebar";
  const canManageStaff = user.isAdmin && onOpenSettings !== undefined;

  return (
    <div ref={menuRef} className={`relative ${inSidebar ? "w-full" : ""}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={[
          "flex items-center gap-2 rounded-md border border-[#d9dee7] bg-white text-left hover:bg-[#f8fafc]",
          inSidebar ? "w-full px-2 py-2" : "px-2.5 py-1.5",
        ].join(" ")}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eaf1f8] text-xs font-semibold text-[#1f4e79]">
          {user.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[#344054]" title={user.email}>
            {user.name}
          </span>
          {inSidebar ? <span className="block truncate text-xs text-[#667085]">{user.email}</span> : null}
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-[#667085]" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          role="menu"
          className={[
            "absolute z-50 w-60 rounded-lg border border-[#d9dee7] bg-white p-1 shadow-lg",
            inSidebar ? "bottom-full left-0 mb-2" : "right-0 mt-2",
          ].join(" ")}
        >
          {canManageStaff ? (
            <>
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                Settings
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings?.();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[#344054] hover:bg-[#f2f7fb]"
              >
                <Users size={15} aria-hidden="true" /> Users
              </button>
              <div className="my-1 border-t border-[#edf0f4]" />
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setIsOpen(false);
              await signOut();
              window.location.reload();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[#344054] hover:bg-[#f2f7fb]"
          >
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
