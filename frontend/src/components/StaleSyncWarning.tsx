/**
 * The pages are old, said once, in front of the work rather than beside it.
 *
 * Every figure in the student database is an answer to a question the registrar was asked
 * at some moment, and the moment has always been in the header in small grey type. A
 * coordinator who did not think to look at it had no way of knowing that the registrations
 * they were reading, the clashes they were settling and the hours they were signing off
 * were yesterday afternoon's — and the portal moves sections, staff and registrations all
 * through the working day.
 *
 * So it is said out loud, once, when the application is opened onto data older than the
 * department is willing to work from, and again if it goes stale while somebody is still
 * in it. Once: a warning that comes back every time a page changes is a warning people
 * learn to dismiss without reading, and on a day when the portal is down there is nothing
 * to be done about it anyway. The age stays in the header for the rest of the day, where
 * it always was.
 *
 * How old is too old belongs to the department, on the Checks panel with the others, which
 * is also where it can be switched off while the portal is out.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { fetchChecks } from "@/services/portalLists";
import { isExtensionInstalled } from "@/services/scenRosters";
import { isRunning, getRun, startRun } from "@/services/syncRun";
import { ageInWords, isStale, STALE_AFTER } from "@/services/syncFreshness";
import { freshen, useSyncTargets } from "@/services/syncTargets";

/** Answered once a session, in this tab: closing it is an answer, not a postponement. */
const ANSWERED = "scen-sync-warning-answered";

function alreadyAnswered(): boolean {
  try {
    return window.sessionStorage.getItem(ANSWERED) === "yes";
  } catch {
    // Private browsing, or storage turned off. Warning twice is better than not at all.
    return false;
  }
}

function remember(): void {
  try {
    window.sessionStorage.setItem(ANSWERED, "yes");
  } catch {
    // A preference that cannot be remembered must never break the page.
  }
}

export function StaleSyncWarning() {
  const client = useQueryClient();
  const { targets, syncedAt } = useSyncTargets();
  const checks = useQuery({ queryKey: ["checks", ""], queryFn: () => fetchChecks(""), retry: false });
  const check = checks.data?.find((one) => one.name === "portal_sync_age");
  const [answered, setAnswered] = useState(alreadyAnswered);
  const [missing, setMissing] = useState(false);
  const [starting, setStarting] = useState(false);
  /*
   * Looked at every half minute, so a tab left open across the line is warned when it
   * crosses it rather than the next time somebody reloads — which on a page people leave
   * open all day is the difference between a warning and no warning at all.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const hours = check?.enabled === false ? 0 : (check?.threshold ?? STALE_AFTER);
  /*
   * Nothing at all until the department's answer is in hand. Deciding on the default and
   * correcting a moment later showed the warning and took it away again — a modal that
   * flashes past is worse than no modal, because the reader is left wondering what it
   * said. A failed request falls back to the default, which is the honest guess.
   */
  if (checks.isPending) return null;
  // Not while a sync is going: it is already being answered, and a warning about it would
  // be a warning about the thing the coordinator is watching happen.
  const stale = isStale({ syncedAt, now, hours }) && !isRunning(getRun());
  if (answered || !stale || !syncedAt) return null;

  const close = () => {
    remember();
    setAnswered(true);
  };
  const begin = async () => {
    setStarting(true);
    setMissing(false);
    if (!(await isExtensionInstalled())) {
      setMissing(true);
      setStarting(false);
      return;
    }
    close();
    await startRun(targets, () => freshen(client));
  };

  return (
    <Modal
      open
      onClose={close}
      title={`The portal data is ${ageInWords(syncedAt, now)} old`}
      description="Everything the student pages show was true when the registrar was last asked. Sections, staffing and registrations move during the day."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f7f8fa]"
          >
            Work from it anyway
          </button>
          <button
            type="button"
            onClick={() => void begin()}
            disabled={starting || !targets.length}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1a4368] disabled:opacity-50"
          >
            <RefreshCw size={15} aria-hidden="true" />
            {starting ? "Starting…" : "Sync now"}
          </button>
        </div>
      }
    >
      <p className="flex items-start gap-2 text-sm leading-6 text-[#667085]">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#c9a227]" aria-hidden="true" />
        <span>
          A sync asks the portal for every list again and takes a few minutes. Until then the pages answer the question
          the registrar was asked {ageInWords(syncedAt, now)} ago.
        </span>
      </p>
      {missing ? (
        <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
          The registrar extension did not answer, so nothing can be asked of the portal from here. Open Chrome with the
          extension installed, then sync from the button at the top right.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-[#98a2b3]">
        How old is too old is set on Active CRNs, under Checks — including turning this off while the portal is down.
      </p>
    </Modal>
  );
}
