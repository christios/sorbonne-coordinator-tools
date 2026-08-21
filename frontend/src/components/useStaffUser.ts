import { createContext, useContext } from "react";

import type { StaffUser } from "@/services/auth";

export const StaffContext = createContext<StaffUser | null>(null);

/** The signed-in coordinator. Only ever called from inside the sign-in gate. */
export function useStaffUser(): StaffUser | null {
  return useContext(StaffContext);
}
