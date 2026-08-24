import { AlertCircle } from "lucide-react";

/**
 * What the semester pages say when this deployment has no student platform behind them.
 *
 * Timetables live in the SCEN Student Platform, which is a separate deployment. Only the
 * pages that talk to it are affected — the roster, the cohorts and the groups are this
 * application's own, and go on working when the connection is missing.
 */
export function PlatformNotConfigured() {
  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-[#171717]">
        <AlertCircle size={20} className="text-[#a6292f]" aria-hidden="true" />
        Timetable uploads are not configured
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667085]">
        This deployment has no connection to the SCEN Student Platform. Set{" "}
        <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SCEN_STUDENT_PLATFORM_URL</code> and{" "}
        <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SCEN_STUDENT_PLATFORM_TOKEN</code> in the
        application settings, then redeploy.
      </p>
    </section>
  );
}
