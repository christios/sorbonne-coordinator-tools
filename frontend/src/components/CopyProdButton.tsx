import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Loader2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { API_BASE_URL, apiFetch } from "@/services/http";

/**
 * Bring production's data down to this machine, for people developing against it.
 *
 * It exists twice over only in development: this component is behind `import.meta.env.DEV`,
 * so it is not in a production build at all, and the route it calls is only mounted when
 * the server's own database is on localhost. Either alone would do; both is cheap.
 *
 * It replaces rather than merges: every table on this laptop becomes production's, row for
 * row and id for id, so a page on this machine shows what the same page shows in
 * production. It used to copy a feature at a time and silently left half the schema
 * behind — dismissals, cancellations, comments, tasks, syllabi — which on screen looked
 * like bugs in the pages. That is destructive to whatever is on this laptop, which is why
 * it asks first.
 */
type CopyReport = {
  tables?: Record<string, number>;
  rows?: number;
  semesters?: { paired: { production: string; here: string }[]; unpaired: string[] };
};

/**
 * Which of this machine's Student Hub semesters production's became. The Hub is not
 * copied, so its semesters keep their own ids here and the copy is rewritten to name them —
 * and a production semester with no match here is one whose sets no page will show.
 */
function semestersSaid(report: CopyReport): string {
  const paired = (report.semesters?.paired ?? []).map((pair) => `“${pair.production}” is “${pair.here}” here`);
  const unpaired = (report.semesters?.unpaired ?? []).map((name) => `“${name}”`);
  return [
    paired.length ? `Semesters: ${paired.join(", ")}.` : "",
    unpaired.length ? `No semester here matches ${unpaired.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function CopyProdButton() {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const copy = useMutation({
    mutationFn: async () => {
      const answer = await apiFetch(`${API_BASE_URL}/api/v1/dev/copy-from-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      /*
       * Read the body once, as text. A Response can only be consumed once, so asking for
       * .json() in both branches throws on the error path and hides what actually went
       * wrong — and an answer with no body at all is not a fact about JSON, it is a fact
       * about the address, so say the status rather than let the parser speak.
       */
      const text = await answer.text();
      const body = (text ? JSON.parse(text) : {}) as CopyReport & { detail?: string };
      if (!answer.ok) throw new Error(body.detail ?? `The API answered ${answer.status} and said nothing.`);
      return body;
    },
    onSettled: () => setAsking(false),
    onSuccess: (report) => {
      const tables = Object.keys(report.tables ?? {}).length;
      setDone(
        [`${tables} tables, ${(report.rows ?? 0).toLocaleString()} rows — exactly as production holds them.`, semestersSaid(report)]
          .filter(Boolean)
          .join(" "),
      );
      // Everything on screen was read from the database this just replaced.
      client.invalidateQueries();
    },
  });

  if (!import.meta.env.DEV) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={copy.isPending}
        title="Development only: replace this machine's data with production's"
        className="inline-flex items-center gap-2 rounded-md border border-dashed border-[#c8b78a] bg-[#fdfaf2] px-3 py-2 text-sm font-semibold text-[#8a6116] hover:bg-[#fdf6e7] disabled:opacity-50"
      >
        {copy.isPending ? (
          <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <CloudDownload size={15} className="shrink-0" aria-hidden="true" />
        )}
        {copy.isPending ? "Copying…" : "Copy prod"}
      </button>

      <ConfirmDialog
        open={asking}
        busy={copy.isPending}
        title="Replace this machine's data with production's?"
        description="Every table on this laptop is emptied and filled with production's — students, cohorts, teachers and their contact details, dismissals, comments, tasks, syllabi and users. Nothing is written to production, and API tokens stay behind."
        confirmLabel="Copy production"
        onConfirm={() => copy.mutate()}
        onClose={() => setAsking(false)}
      />

      {done ? (
        <span role="status" className="text-xs text-[#2f6b3d]">
          {done}
        </span>
      ) : null}
      {copy.error ? (
        <span role="alert" className="text-xs text-[#a6292f]">
          {(copy.error as Error).message}
        </span>
      ) : null}
    </>
  );
}
