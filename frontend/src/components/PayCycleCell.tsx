import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SelectMenu } from "@/components/SelectMenu";

import { cycleLabel, opensOnFor, periodContaining, periodLabel, PERIOD_OPENS_ON } from "@/services/payPeriods";
import { fetchPayCycles, setPayCycle } from "@/services/teachers";

/** Every day a period may open on. Later than the 28th and February would have none. */
const DAYS = Array.from({ length: 28 }, (_, at) => at + 1);

/**
 * Which day this semester's pay periods open on.
 *
 * The department pays part-time teaching from the 15th of one month to the 14th of the
 * next — which is why five of its time sheets are called "AugSept": one period, not two
 * months. That day was written once in the browser and could not be changed without a
 * release, though a semester can perfectly well be paid on a different cycle.
 *
 * Shown here because the semester is the thing that decides. The period running now is
 * printed under the choice, since "the 20th" on its own does not tell you what a claim
 * would cover, and that is the question being answered.
 */
export function PayCycleCell({ termId, termName }: { termId: string; termName: string }) {
  const client = useQueryClient();
  const cycles = useQuery({ queryKey: ["pay-cycles"], queryFn: fetchPayCycles });
  const fallback = cycles.data?.default ?? PERIOD_OPENS_ON;
  const held = cycles.data?.cycles ?? {};
  const opensOn = opensOnFor(held, termId, fallback);
  const decided = typeof held[termId] === "number";

  const save = useMutation({
    mutationFn: (day: number) => setPayCycle(termId, day),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["pay-cycles"] }),
  });

  return (
    <div className="min-w-[10rem]">
      {/* The shared control, not a native select — see docs/handoffs/ui-ux-decisions.md. */}
      <SelectMenu
        label={`Pay periods for ${termName}`}
        value={String(opensOn)}
        onChange={(chosen) => save.mutate(Number(chosen))}
        disabled={cycles.isLoading || save.isPending}
        options={DAYS.map((day) => ({ value: String(day), label: `Opens ${cycleLabel(day)}` }))}
      />
      <span className="mt-1 block text-xs text-[#98a2b3]">
        {save.error ? (
          <span role="alert" className="text-[#a6292f]">{(save.error as Error).message}</span>
        ) : (
          <>
            {periodLabel(periodContaining(new Date(), opensOn))}
            {decided ? "" : " · as the department usually pays"}
          </>
        )}
      </span>
    </div>
  );
}
