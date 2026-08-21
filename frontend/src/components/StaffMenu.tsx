import { LogOut } from "lucide-react";

import { useStaffUser } from "@/components/useStaffUser";
import { signOut } from "@/services/auth";

/** Who is signed in, and the way out. Sits beside the header's own controls. */
export function StaffMenu() {
  const user = useStaffUser();

  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-[#667085] sm:inline" title={user.email}>
        {user.name}
      </span>
      <button
        type="button"
        onClick={async () => {
          await signOut();
          window.location.reload();
        }}
        className="inline-flex items-center gap-2 rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <LogOut size={15} aria-hidden="true" /> Sign out
      </button>
    </div>
  );
}
