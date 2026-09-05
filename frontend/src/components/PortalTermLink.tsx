import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchTermCheck, fetchTermLinks, linkTerm } from "@/services/portalLists";

/**
 * Which portal term a Student Hub semester is, and what the portal says about its CRNs.
 *
 * The Hub names a semester; the portal numbers a term (262710). Nothing joins the two
 * until somebody says so here — and once said, a CRN typed into a group, a CRN the
 * timetable teaches and a CRN the portal registered can be held against each other.
 */
export function PortalTermLink({ termId }: { termId: string }) {
  const client = useQueryClient();
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks });
  const linked = links.data?.[termId] ?? "";
  const [draft, setDraft] = useState(linked);
  const [asked, setAsked] = useState(false);

  useEffect(() => setDraft(linked), [linked]);

  const save = useMutation({
    mutationFn: (code: string) => linkTerm(termId, code),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["term-links"] });
      client.invalidateQueries({ queryKey: ["portal-crns", termId] });
      client.invalidateQueries({ queryKey: ["portal-term-check", termId] });
    },
  });
  const check = useQuery({
    queryKey: ["portal-term-check", termId],
    queryFn: () => fetchTermCheck(termId),
    enabled: asked && Boolean(linked),
    retry: false,
  });

  return (
    <div className="min-w-[11rem]">
      <div className="flex items-center gap-2">
        <input
          aria-label="Portal term code"
          value={draft}
          inputMode="numeric"
          placeholder="262710"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = draft.trim();
            if (next !== linked) save.mutate(next);
          }}
          className="w-24 rounded-md border border-[#cbd5e1] px-2 py-1.5 text-sm tabular-nums"
        />
        {linked ? (
          <button
            type="button"
            aria-label="Check the timetable against the portal"
            title="Check the timetable's CRNs against the portal's list"
            onClick={() => setAsked(true)}
            className="rounded-md border border-[#b7bec8] bg-white p-1.5 text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]"
          >
            {check.isFetching ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ScanSearch size={15} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {save.error ? <p role="alert" className="mt-1 text-xs text-[#a6292f]">{(save.error as Error).message}</p> : null}
      {check.error ? <p role="alert" className="mt-1 text-xs text-[#a6292f]">{(check.error as Error).message}</p> : null}
      {check.data ? (
        <div className="mt-1 text-xs leading-5 text-[#667085]">
          {check.data.portalCourses === 0 ? (
            <p>The portal&apos;s list for {check.data.portalTermCode} has not been pulled yet — see Courses.</p>
          ) : (
            <>
              <p>
                {check.data.portalCourses} portal CRNs ·{" "}
                <span className={check.data.hubOnly.length ? "font-semibold text-[#a6292f]" : ""}>
                  {check.data.hubOnly.length} timetable CRN{check.data.hubOnly.length === 1 ? "" : "s"} not in the portal
                </span>{" "}
                · {check.data.teacherDiffers.length} teacher{check.data.teacherDiffers.length === 1 ? "" : "s"} differ
              </p>
              {check.data.hubOnly.slice(0, 6).map((row) => (
                <p key={row.crn} className="text-[#a6292f]">
                  {row.crn} {row.code}
                </p>
              ))}
              {check.data.teacherDiffers.slice(0, 6).map((row) => (
                <p key={row.crn}>
                  {row.crn} {row.code}: timetable {row.hub}, portal {row.portal}
                </p>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
