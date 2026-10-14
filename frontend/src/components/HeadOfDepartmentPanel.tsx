/**
 * Who the Head of Department is: one of the Active teachers, chosen once for every Part
 * Time Sheet rather than read off whoever approved a given period.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SelectMenu } from "@/components/SelectMenu";
import { fetchHeadOfDepartment, setHeadOfDepartment } from "@/services/departmentRoles";
import { fetchActiveTeachers } from "@/services/portalLists";
import { describeAge } from "@/services/rosterStore";

export function HeadOfDepartmentPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const head = useQuery({ queryKey: ["head-of-department"], queryFn: fetchHeadOfDepartment, retry: false });
  const actives = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const save = useMutation({
    mutationFn: setHeadOfDepartment,
    onSuccess: (saved) => client.setQueryData(["head-of-department"], saved),
  });
  const people = [...(actives.data ?? [])]
    .filter((teacher) => teacher.fullName.trim())
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
  const set = head.data?.updatedAt ? Date.parse(head.data.updatedAt) : Number.NaN;

  return (
    <div className="grid gap-2">
      <div className="w-80 max-w-full">
        <SelectMenu
          label="Head of Department"
          value={head.data?.activeTeacherId ?? ""}
          onChange={(id) => save.mutate(id)}
          disabled={!canChange || save.isPending || head.isPending}
          searchable
          searchPlaceholder="Find somebody on Active teachers"
          placeholder={head.isPending ? "Reading…" : "Nobody named"}
          options={[
            { value: "", label: "Nobody named" },
            ...people.map((teacher) => ({
              value: teacher.id,
              label: teacher.fullName,
              searchText: teacher.email,
            })),
          ]}
        />
      </div>
      <p className="text-xs text-[#667085]">
        {head.data?.activeTeacherId && head.data.updatedBy && !Number.isNaN(set)
          ? `Set by ${head.data.updatedByName || head.data.updatedBy}, ${describeAge(set, Date.now())}.`
          : head.data && !head.data.activeTeacherId
            ? "Nobody is named, so the Head of Department line of the Part Time Sheet is left blank."
            : ""}
        {canChange ? "" : " Only an administrator can change it."}
      </p>
      {save.error ? (
        <p role="alert" className="text-sm text-[#8f1f25]">
          {(save.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
