import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Send, Users } from "lucide-react";
import { useState } from "react";

import { ScreenLoading } from "@/components/ScreenLoading";
import {
  type Publication,
  type PublicationPreview,
  fetchPublication,
  previewPublication,
  publishEnrolments,
} from "@/services/publication";
import { blockersOf, describeChange, isDestructive, sortCohorts } from "@/services/publicationView";
import type { TimetableTerm } from "@/services/timetables";

/**
 * Sending a semester's enrolments to the students.
 *
 * Three steps, and the middle one is the reason this screen exists. Publishing replaces:
 * whatever this application resolves becomes the whole truth, so a cohort nobody filled does
 * not fail to publish — it publishes a hundred students with no timetable. So the screen
 * shows what stands in the way, then what would change, and only then offers the button.
 */
export function SemesterPublish({ term, onBack }: { term: TimetableTerm; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [published, setPublished] = useState<number | null>(null);

  const publication = useQuery({
    queryKey: ["publication", term.id],
    queryFn: () => fetchPublication(term.id),
  });

  const check = useMutation({
    mutationFn: () => previewPublication(term.id),
    onSuccess: (payload) => {
      setPreview(payload);
      setPublished(null);
    },
  });

  const send = useMutation({
    mutationFn: () => publishEnrolments(term.id, preview?.baseUpdatedAt ?? null),
    onSuccess: (result) => {
      setPublished(result.studentCount);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["timetable-terms"] });
      queryClient.invalidateQueries({ queryKey: ["publication", term.id] });
    },
  });

  const error = publication.error?.message ?? check.error?.message ?? send.error?.message ?? null;

  return (
    <section className="pb-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" /> All semesters
      </button>

      <div className="rounded-lg border border-[#d9dee7] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#171717]">Publish {term.name} to students</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
          This sends what the blocks say: every student&rsquo;s group becomes the courses they see.
          Publishing <b>replaces</b> what students have now, so anyone this application does not
          place in a group loses their timetable.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]"
          >
            {error}
          </p>
        ) : null}

        {published !== null ? (
          <div className="mt-4 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={17} aria-hidden="true" /> {term.name} published
            </p>
            <p className="mt-1 leading-6">
              {published} student(s) can now look up their timetable. Anyone with the page open is
              offered a refresh.
            </p>
          </div>
        ) : null}
      </div>

      {publication.isLoading ? <ScreenLoading label="Checking what this semester holds…" /> : null}

      {publication.data ? (
        <>
          <Readiness publication={publication.data} />

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => check.mutate()}
              disabled={check.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-4 py-2.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
            >
              {check.isPending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : null}
              See what would change
            </button>
            {!publication.data.isReady ? (
              <span className="text-sm text-[#8a6116]">
                You can still look, but fix the above before sending it to students.
              </span>
            ) : null}
          </div>

          {preview ? <Change preview={preview} onPublish={() => send.mutate()} busy={send.isPending} /> : null}
        </>
      ) : null}
    </section>
  );
}

function Readiness({ publication }: { publication: Publication }) {
  const blockers = blockersOf(publication);

  return (
    <div className="mt-5 rounded-lg border border-[#d9dee7] bg-white p-5">
      <h4 className="flex items-center gap-2 text-base font-semibold text-[#171717]">
        <Users size={17} className="text-[#1f4e79]" aria-hidden="true" />
        {publication.resolved.students} student(s) would be enrolled in {publication.resolved.enrolments} course
        place(s)
      </h4>

      {publication.cohorts.length > 0 ? (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              <th scope="col" className="py-2 font-semibold">Cohort</th>
              <th scope="col" className="py-2 text-right font-semibold">Students</th>
              <th scope="col" className="py-2 text-right font-semibold">Placed</th>
              <th scope="col" className="py-2 pl-4 font-semibold">What is missing</th>
            </tr>
          </thead>
          <tbody>
            {sortCohorts(publication.cohorts).map((cohort) => (
              <tr key={cohort.cohortId} className="border-t border-[#eef1f5]">
                <td className="py-2.5 font-semibold text-[#171717]">{cohort.cohort}</td>
                <td className="py-2.5 text-right tabular-nums">{cohort.students}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {cohort.isReady ? (
                    <span className="text-[#2f6b3d]">{cohort.studentsResolved}</span>
                  ) : (
                    <span className="font-semibold text-[#a6292f]">{cohort.studentsResolved}</span>
                  )}
                </td>
                <td className="py-2.5 pl-4 text-[#667085]">
                  {cohort.isReady ? "—" : cohort.warnings.join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {blockers.map((blocker) => (
            <li
              key={blocker.label}
              className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm leading-6 ${
                blocker.severity === "blocking"
                  ? "border-[#e5b7b9] bg-[#fdf3f3] text-[#a6292f]"
                  : "border-[#e8d9ac] bg-[#fdf9ee] text-[#8a6116]"
              }`}
            >
              <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <b>{blocker.label}</b>
                {blocker.detail ? <span className="block font-normal">{blocker.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#2f6b3d]">
          <CheckCircle2 size={16} aria-hidden="true" /> Everyone has a group and every CRN is in the timetable.
        </p>
      )}
    </div>
  );
}

function Change({
  preview,
  onPublish,
  busy,
}: {
  preview: PublicationPreview;
  onPublish: () => void;
  busy: boolean;
}) {
  const destructive = isDestructive(preview);
  const nothingToDo = preview.summary.enrolmentsAdded === 0 && preview.summary.enrolmentsRemoved === 0;

  return (
    <div className="mt-5 rounded-lg border border-[#d9dee7] bg-white p-5">
      <h4 className="text-base font-semibold text-[#171717]">What students would see change</h4>
      <p className={`mt-2 text-sm leading-6 ${destructive ? "font-semibold text-[#a6292f]" : "text-[#344054]"}`}>
        {describeChange(preview)}
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Count label="Enrolled now" value={preview.summary.studentsBefore} />
        <Count label="Enrolled after" value={preview.summary.studentsAfter} />
        <Count label="Added" value={preview.summary.enrolmentsAdded} />
        <Count label="Removed" value={preview.summary.enrolmentsRemoved} danger={destructive} />
        <Count label="Unchanged" value={preview.summary.enrolmentsUnchanged} muted />
      </dl>

      {preview.unknownCrns.length > 0 ? (
        <p className="mt-3 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm text-[#8a6116]">
          {preview.unknownCrns.length} CRN(s) are not in this timetable and would enrol nobody:{" "}
          {preview.unknownCrns.slice(0, 8).join(", ")}
        </p>
      ) : null}

      {destructive ? (
        <p className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm leading-6 text-[#a6292f]">
          <b>That is what a cohort nobody has placed in groups looks like.</b> Check the list above before
          sending this: a student this application does not put in a group is not left alone, they are
          emptied.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onPublish}
        disabled={busy || nothingToDo}
        className={`mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5] ${
          destructive ? "bg-[#a6292f] hover:bg-[#8f1f25]" : "bg-[#1f4e79] hover:bg-[#183f63]"
        }`}
      >
        {busy ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
        {nothingToDo ? "Nothing to publish" : destructive ? "Publish anyway" : "Publish to students"}
      </button>
    </div>
  );
}

function Count({
  label,
  value,
  muted = false,
  danger = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
  danger?: boolean;
}) {
  const tone = danger ? "text-[#a6292f]" : muted ? "text-[#98a2b3]" : "text-[#171717]";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#667085]">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
