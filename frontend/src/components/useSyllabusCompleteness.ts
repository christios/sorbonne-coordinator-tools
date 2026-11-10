import { useQuery } from "@tanstack/react-query";

import { useStaffUser } from "@/components/useStaffUser";
import { getSyllabusCompleteness, type Syllabus } from "@/services/syllabi";

/**
 * What the saved syllabus still lacks, for whoever may write it (Christian, 10 Nov 2026: the
 * same rule as the server's can_edit). Shared by the header's list and the section menu's
 * counts, so both answer from one request, asked again whenever a save changes the revision.
 */
export function useSyllabusCompleteness(syllabus: Syllabus) {
  const user = useStaffUser();
  const mine = Boolean(syllabus.ownerEmail) && syllabus.ownerEmail === user?.email;
  const curator = Boolean(user?.isAdmin) || user?.apps?.syllabus === "admin";
  const shared = !syllabus.ownerEmail;
  const canEdit = mine || (curator && (shared || syllabus.visibility === "public"));
  const completeness = useQuery({
    queryKey: ["syllabus-completeness", syllabus.id, syllabus.revision],
    queryFn: () => getSyllabusCompleteness(syllabus.id),
    enabled: canEdit,
  });
  const missing = canEdit ? completeness.data?.missing ?? [] : [];
  return { canEdit, completeness, missing };
}
