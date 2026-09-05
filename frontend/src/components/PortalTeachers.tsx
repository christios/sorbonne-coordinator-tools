import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Link2Off, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { PortalFilterBar } from "@/components/PortalFilterBar";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import {
  type PartTimeTeacher,
  type PortalTeacher,
  addPartTimeTeacher,
  fetchPartTimeTeachers,
  fetchPortalTeachers,
  linkTeacher,
} from "@/services/portalLists";

const FILTER_KEY = "scen-portal-filter:teachers";

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Who the portal says teaches, as the department's own list of the teachers it deals with.
 *
 * Mirrors the portal's staff list, pulled by filter. The part-time teacher database is a
 * separate application with its own records, folders and requisitions; a portal teacher
 * can be matched to a record there, or added to it, so the two lists agree on who a
 * person is without either owning the other.
 */
export function PortalTeachers() {
  const client = useQueryClient();
  const [filterId, setFilterId] = useState(() => {
    try {
      return window.localStorage.getItem(FILTER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [type, setType] = useState("");
  const [withGone, setWithGone] = useState(false);
  const teachers = useQuery({ queryKey: ["portal", "teachers", filterId], queryFn: () => fetchPortalTeachers(filterId) });
  const partTime = useQuery({ queryKey: ["part-time-teachers"], queryFn: fetchPartTimeTeachers });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["portal", "teachers"] });
    client.invalidateQueries({ queryKey: ["part-time-teachers"] });
  };
  const link = useMutation({
    mutationFn: ({ teacherId, partTimeTeacherId }: { teacherId: string; partTimeTeacherId: string }) =>
      linkTeacher(teacherId, partTimeTeacherId),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: async (teacher: PortalTeacher) => {
      const made = await addPartTimeTeacher({ fullName: teacher.fullName, email: teacher.psuadEmail });
      return linkTeacher(teacher.teacherId, made.id);
    },
    onSuccess: refresh,
  });

  /** The part-time record a portal teacher most likely is: same university e-mail, else the same name. */
  const suggestions = useMemo(() => {
    const byEmail = new Map<string, PartTimeTeacher>();
    const byName = new Map<string, PartTimeTeacher>();
    for (const record of partTime.data ?? []) {
      if (record.email) byEmail.set(fold(record.email), record);
      if (record.fullName) byName.set(fold(record.fullName), record);
    }
    return (teacher: PortalTeacher) =>
      (teacher.psuadEmail && byEmail.get(fold(teacher.psuadEmail))) || byName.get(fold(teacher.fullName)) || null;
  }, [partTime.data]);
  const partTimeById = new Map((partTime.data ?? []).map((record) => [record.id, record]));

  const types = [...new Set((teachers.data ?? []).map((teacher) => teacher.type).filter(Boolean))].sort();
  const rows = (teachers.data ?? []).filter(
    (teacher) => (!type || teacher.type === type) && (withGone || teacher.status === "in_portal"),
  );

  const columns: SimpleColumn<PortalTeacher>[] = [
    { key: "teacherId", label: "ID", value: (row) => row.teacherId, width: "6.5rem" },
    { key: "fullName", label: "Name", value: (row) => row.fullName },
    { key: "type", label: "Type", value: (row) => row.type },
    { key: "category", label: "Category", value: (row) => row.category },
    { key: "department", label: "Dept.", value: (row) => row.department },
    { key: "courses", label: "Courses", value: (row) => row.courses },
    { key: "lastTerm", label: "Last term", value: (row) => row.lastTerm },
    { key: "rank", label: "Rank", value: (row) => row.rank },
    {
      key: "psuadEmail",
      label: "E-mail",
      value: (row) => row.psuadEmail,
      render: (row) =>
        row.psuadEmail ? (
          <a href={`mailto:${row.psuadEmail}`} className="text-[#1f4e79] underline">
            {row.psuadEmail}
          </a>
        ) : (
          ""
        ),
    },
    {
      key: "partTime",
      label: "Part-time database",
      value: (row) => (row.partTimeTeacherId ? partTimeById.get(row.partTimeTeacherId)?.fullName ?? "linked" : ""),
      render: (row) => {
        const busy = link.isPending || add.isPending;
        if (row.partTimeTeacherId) {
          const record = partTimeById.get(row.partTimeTeacherId);
          return (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-[#2f6b3d]">{record?.fullName ?? "Linked"}</span>
              <button
                type="button"
                aria-label={`Unlink ${row.fullName} from the part-time database`}
                disabled={busy}
                onClick={() => link.mutate({ teacherId: row.teacherId, partTimeTeacherId: "" })}
                className="text-[#98a2b3] hover:text-[#a6292f]"
              >
                <Link2Off size={14} aria-hidden="true" />
              </button>
            </span>
          );
        }
        const suggestion = suggestions(row);
        return suggestion ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => link.mutate({ teacherId: row.teacherId, partTimeTeacherId: suggestion.id })}
            className="inline-flex items-center gap-1.5 text-[#1f4e79] underline"
          >
            <Link2 size={14} aria-hidden="true" /> Match to {suggestion.fullName}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => add.mutate(row)}
            className="inline-flex items-center gap-1.5 text-[#667085] hover:text-[#1f4e79]"
          >
            <UserPlus size={14} aria-hidden="true" /> Add to part-time database
          </button>
        );
      },
    },
  ];

  const error = link.error?.message ?? add.error?.message ?? null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[#667085]">
          The portal&apos;s staff list, pulled by filter. Personal contact details never leave the portal.
          A teacher can be matched to the Part-time Teacher Database, or added to it.
        </p>
        <PortalFilterBar
          kind="teachers"
          filterId={filterId}
          onChoose={(id) => {
            setFilterId(id);
            try {
              window.localStorage.setItem(FILTER_KEY, id);
            } catch {
              // fine
            }
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}

      {teachers.isLoading ? (
        <ScreenLoading label="Loading teachers…" />
      ) : teachers.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(teachers.error as Error).message}</p>
      ) : (
        <SimpleTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.teacherId}
          initialSort={{ key: "fullName", ascending: true }}
          searchLabel="Search teachers"
          empty={filterId ? "Nothing pulled yet — sync the filter." : "Choose a portal filter, or make one."}
          toolbar={
            <>
              {types.length > 1 ? (
                <div className="w-56">
                  <SelectMenu
                    label="Type"
                    value={type}
                    placeholder="Every type"
                    onChange={setType}
                    options={[{ value: "", label: "Every type" }, ...types.map((value) => ({ value, label: value }))]}
                  />
                </div>
              ) : null}
              <label className="inline-flex items-center gap-2 text-sm text-[#344054]">
                <input type="checkbox" checked={withGone} onChange={(event) => setWithGone(event.target.checked)} />
                Show teachers no longer returned
              </label>
            </>
          }
        />
      )}
    </section>
  );
}
