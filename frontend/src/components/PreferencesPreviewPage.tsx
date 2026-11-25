import { useQuery } from "@tanstack/react-query";
import { Eye, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import { previewSource, readPreviewSemester, SAMPLE_TEACHER } from "@/services/wishPreview";

/**
 * The request as a teacher sees it, for the coordinators (25 Nov 2026): the page a teacher's link
 * opens, with a sample full-timer who leads a course — so every step shows — on the semester's
 * own settings and weeks. Nothing is saved; Start again puts the page back as it was.
 *
 * It reads the semester with the coordinator's sign-in: signed out, it says to sign in first.
 */
export function PreferencesPreviewPage({ term }: { term: string }) {
  // Read once: read again, it would start the sample over, and lose what was tried.
  const semester = useQuery({
    queryKey: ["preferences-preview", term],
    queryFn: () => readPreviewSemester(term),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const source = useMemo(() => (semester.data ? previewSource(semester.data) : undefined), [semester.data]);

  if (!source) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f8fa] px-4">
        <div className="max-w-md rounded-xl border border-[#d9dee7] bg-white p-6 text-sm text-[#475467] shadow-sm">
          {semester.isError ? (
            <>
              <p className="text-base font-semibold text-[#171717]">This preview could not be opened</p>
              <p className="mt-2">
                It is for the coordinators: sign in to{" "}
                <a href="/" className="font-semibold text-[#1f4e79] underline">
                  Coordinator Tools
                </a>{" "}
                first, then open this link again.
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Opening the preview…
            </p>
          )}
        </div>
      </main>
    );
  }
  return (
    <InvitedWishesPage
      code={`preview-${term}`}
      source={source}
      banner={
        <div
          role="note"
          data-preview=""
          className="mx-auto mb-4 flex max-w-5xl items-start gap-2.5 rounded-lg border border-[#e5b454] bg-[#fdf6e3] px-4 py-3 text-sm text-[#7a5410]"
        >
          <Eye size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <b>Preview: what a teacher sees.</b> {SAMPLE_TEACHER} is a full-timer who leads a course, so every step shows,
            on this semester&rsquo;s own settings and weeks. <b>Nothing here is saved</b>, and no teacher sees it.{" "}
            <span className="whitespace-nowrap">Start again (top right) clears it.</span>
          </p>
        </div>
      }
    />
  );
}
