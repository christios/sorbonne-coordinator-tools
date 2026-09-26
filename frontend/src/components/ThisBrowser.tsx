import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HistoryBackup } from "@/components/HistoryBackup";
import { forgetHistory } from "@/services/pullHistory";
import { describeAge, forgetRosters, latestPullAt, namesHeld } from "@/services/rosterStore";

/**
 * What this browser holds that the server does not: the names, e-mails and year levels the
 * portal gave it, and the history of what the portal has said since.
 *
 * Both used to be two links at the end of a line of grey under the Students table. They
 * are things done once in a long while — clearing a shared computer, keeping the history
 * somewhere it survives — so they live here, where settings are, and the table keeps its
 * room for the students.
 */
export function ThisBrowser() {
  const [held, setHeld] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [forgotten, setForgotten] = useState(false);

  const read = () => {
    void namesHeld().then((names) => setHeld(Object.keys(names).length));
    void latestPullAt().then(setSyncedAt);
  };
  useEffect(read, []);

  return (
    <section className="mt-6 max-w-2xl space-y-6">
      <div className="rounded-lg border border-[#e4e8ef] bg-white px-5 py-4">
        <h3 className="text-sm font-semibold text-[#171717]">Names from the portal</h3>
        <p className="mt-1 text-sm leading-6 text-[#667085]">
          {held === null
            ? "Reading…"
            : held
              ? `${held} student${held === 1 ? "" : "s"} named in this browser${syncedAt ? `, last synced ${describeAge(syncedAt)}` : ""}. Nobody else sees them: the server holds ids only.`
              : "No names in this browser yet. Sync on the Students page to fill them in."}
        </p>
        {forgotten ? <p className="mt-2 text-sm text-[#2f6b3d]">Forgotten. Sync again and the names come back.</p> : null}
        <button
          type="button"
          disabled={!held}
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Forget stored rosters
        </button>
      </div>

      <div className="rounded-lg border border-[#e4e8ef] bg-white px-5 py-4">
        <h3 className="text-sm font-semibold text-[#171717]">History of what the portal said</h3>
        <p className="mt-1 text-sm leading-6 text-[#667085]">
          It exists in this browser alone, so clearing site data ends it. Back it up to a folder and it is written
          there after every sync.
        </p>
        <div className="mt-3 text-sm">
          <HistoryBackup
            onRestored={read}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Forget the stored rosters?"
        description={
          "The names, e-mail addresses and year levels pulled from the portal are held in this " +
          "browser and will be cleared, along with the history of what the portal has said. No " +
          "student leaves the list and no cohort changes — the ids we keep are on the server and " +
          "are not touched. Sync again and the names come back."
        }
        confirmLabel="Forget rosters"
        onConfirm={() => {
          void Promise.all([forgetRosters(), forgetHistory()]).then(() => {
            setForgotten(true);
            read();
          });
          setConfirming(false);
        }}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
