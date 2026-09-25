import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ScreenLoading } from "@/components/ScreenLoading";
import { rememberProgrammeCodes } from "@/services/programmes";
import { fetchProgrammeCodes } from "@/services/programmeCodes";

/**
 * The student pages, once the department's programme codes are in hand.
 *
 * Every page that places a student, judges a cohort's majors or reads a group's rows
 * compares programme codes, and "MATS means MATH" has to be known before the first of
 * them does — a page that judged first would put MATS students in no group and keep that
 * answer. It is one short list, so the wait is a moment; and a list that cannot be read
 * does not stop anybody working: the pages open on the codes as the portal writes them.
 */
export function ProgrammeCodesReady({ children }: { children: ReactNode }) {
  const codes = useQuery({ queryKey: ["programme-codes"], queryFn: fetchProgrammeCodes, retry: false, staleTime: 60_000 });
  if (codes.isPending) return <ScreenLoading label="Reading the programme codes…" />;
  rememberProgrammeCodes(codes.data ?? []);
  return <>{children}</>;
}
