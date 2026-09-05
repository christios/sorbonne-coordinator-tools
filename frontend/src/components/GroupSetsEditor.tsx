import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import {
  type CatalogueGroup,
  type CatalogueScope,
  type Cohort,
  type ScopeKind,
  addCourse,
  addGroup,
  addScope,
  deleteCourse,
  deleteGroup,
  deleteScope,
  fetchCatalogue,
  updateGroup,
  updateScope,
} from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";

const KINDS: { value: ScopeKind; label: string }[] = [
  { value: "shared", label: "Shared numbering across its courses" },
  { value: "independent", label: "Its own numbering" },
  { value: "nested", label: "Nested inside another set" },
];

/**
 * The group sets of one cohort in one semester: what the matrix used to be, as a list.
 *
 * A set is the students' side of the timetable request — TD groups 1 to 6, the two CM
 * groups, Readiness, a TP split nested inside the TD groups — and it is defined here
 * rather than on a card because a set spans courses. The cards read it; a section is
 * one group of a set holding one course.
 */
export function GroupSetsEditor({
  open,
  cohorts,
  terms,
  initialCohortId = "",
  initialTermId = "",
  onClose,
  onChanged,
}: {
  open: boolean;
  cohorts: Cohort[];
  terms: TimetableTerm[];
  initialCohortId?: string;
  initialTermId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const client = useQueryClient();
  const [cohortId, setCohortId] = useState(initialCohortId || cohorts[0]?.id || "");
  const [termId, setTermId] = useState(initialTermId || terms[0]?.id || "");
  useEffect(() => {
    if (open) {
      setCohortId(initialCohortId || cohorts[0]?.id || "");
      setTermId(initialTermId || terms[0]?.id || "");
    }
  }, [open, initialCohortId, initialTermId, cohorts, terms]);

  const catalogue = useQuery({
    queryKey: ["catalogue", cohortId, termId],
    queryFn: () => fetchCatalogue(cohortId, termId),
    enabled: open && Boolean(cohortId && termId),
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["catalogue"] });
    client.invalidateQueries({ queryKey: ["course-cards"] });
    client.invalidateQueries({ queryKey: ["publication"] });
    onChanged();
  };
  const [newCode, setNewCode] = useState("");
  const [newKind, setNewKind] = useState<ScopeKind>("shared");
  const [newParent, setNewParent] = useState("");
  const [pendingScope, setPendingScope] = useState<CatalogueScope | null>(null);
  const [pendingGroup, setPendingGroup] = useState<CatalogueGroup | null>(null);

  const make = useMutation({
    mutationFn: () => addScope(cohortId, { code: newCode.trim(), termId, kind: newKind, parentScopeId: newKind === "nested" ? newParent : "" }),
    onSuccess: () => {
      setNewCode("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: deleteScope, onSuccess: refresh });
  const removeGroup = useMutation({ mutationFn: deleteGroup, onSuccess: refresh });
  const scopes = catalogue.data?.scopes ?? [];
  const error = make.error?.message ?? remove.error?.message ?? removeGroup.error?.message ?? null;

  return (
    <Modal open={open} size="wide" title="Group sets" description="How a cohort's students are split for a semester. A set spans the courses whose sections share its numbering; a section is one group holding one course." onClose={onClose}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SelectMenu label="Cohort" value={cohortId} onChange={setCohortId} options={cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name }))} />
        <SelectMenu label="Semester" value={termId} onChange={setTermId} placeholder="Choose a semester" options={terms.map((term) => ({ value: term.id, label: term.name }))} />
      </div>
      {error ? <p role="alert" className="mb-3 text-sm text-[#a6292f]">{error}</p> : null}

      {!termId ? (
        <p className="text-sm text-[#667085]">Choose a semester — a group set belongs to one.</p>
      ) : catalogue.isLoading ? (
        <p className="text-sm text-[#667085]">Loading…</p>
      ) : (
        <div className="space-y-4">
          {scopes.map((scope) => (
            <ScopeEditor key={scope.id} scope={scope} scopes={scopes} onChanged={refresh} onRemove={() => setPendingScope(scope)} onRemoveGroup={setPendingGroup} />
          ))}
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[#c8d0da] px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (newCode.trim()) make.mutate();
            }}
          >
            <label className="text-xs font-semibold text-[#344054]">
              New set
              <input aria-label="New group set code" value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="TD, CM, TP, RDNS…" className="mt-1 block w-32 rounded-md border border-[#cbd5e1] px-2 py-1.5 text-sm" />
            </label>
            <div className="w-72">
              <SelectMenu label="Kind" value={newKind} onChange={(value) => setNewKind(value as ScopeKind)} options={KINDS} />
            </div>
            {newKind === "nested" ? (
              <div className="w-48">
                <SelectMenu label="Inside" value={newParent} onChange={setNewParent} placeholder="Which set…" options={scopes.filter((scope) => scope.kind !== "nested").map((scope) => ({ value: scope.id, label: scope.code }))} />
              </div>
            ) : null}
            <button type="submit" disabled={!newCode.trim() || make.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Plus size={14} aria-hidden="true" /> Add set
            </button>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={pendingScope !== null}
        title="Remove this group set?"
        description={pendingScope ? `${pendingScope.code} and its ${pendingScope.groups.length} groups will be removed, and any student sitting in one of them will need placing again.` : ""}
        confirmLabel="Remove set"
        onConfirm={() => {
          if (pendingScope) remove.mutate(pendingScope.id);
          setPendingScope(null);
        }}
        onClose={() => setPendingScope(null)}
      />
      <ConfirmDialog
        open={pendingGroup !== null}
        title="Remove this group?"
        description={pendingGroup ? `${pendingGroup.assigned} student${pendingGroup.assigned === 1 ? "" : "s"} sitting in it will need placing again.` : ""}
        confirmLabel="Remove group"
        onConfirm={() => {
          if (pendingGroup) removeGroup.mutate(pendingGroup.id);
          setPendingGroup(null);
        }}
        onClose={() => setPendingGroup(null)}
      />
    </Modal>
  );
}

function ScopeEditor({
  scope,
  scopes,
  onChanged,
  onRemove,
  onRemoveGroup,
}: {
  scope: CatalogueScope;
  scopes: CatalogueScope[];
  onChanged: () => void;
  onRemove: () => void;
  onRemoveGroup: (group: CatalogueGroup) => void;
}) {
  const [name, setName] = useState(scope.name);
  const [kind, setKind] = useState<ScopeKind>(scope.kind);
  const [parent, setParent] = useState(scope.parentScopeId);
  const [groupLabel, setGroupLabel] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseComponent, setCourseComponent] = useState(scope.code);
  useEffect(() => {
    setName(scope.name);
    setKind(scope.kind);
    setParent(scope.parentScopeId);
  }, [scope]);

  const save = useMutation({
    mutationFn: () => updateScope(scope.id, { code: scope.code, name, note: scope.note, kind, parentScopeId: kind === "nested" ? parent : "" }),
    onSuccess: onChanged,
  });
  const makeGroup = useMutation({
    mutationFn: () => addGroup(scope.id, { label: groupLabel.trim() }),
    onSuccess: () => {
      setGroupLabel("");
      onChanged();
    },
  });
  const makeCourse = useMutation({
    mutationFn: () => addCourse(scope.id, { code: courseCode.trim(), component: courseComponent.trim() }),
    onSuccess: () => {
      setCourseCode("");
      onChanged();
    },
  });
  const removeCourse = useMutation({ mutationFn: deleteCourse, onSuccess: onChanged });
  const parentScope = scopes.find((candidate) => candidate.id === parent) ?? null;
  const field = "rounded-md border border-[#cbd5e1] px-2 py-1 text-sm";
  const error = save.error?.message ?? makeGroup.error?.message ?? makeCourse.error?.message ?? null;

  return (
    <section className="rounded-lg border border-[#d9dee7] px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <span className="text-base font-semibold text-[#171717]">{scope.code}</span>
        <label className="text-xs font-semibold text-[#344054]">
          Name
          <input aria-label={`Name of ${scope.code}`} value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name !== scope.name && save.mutate()} className={`mt-1 block w-40 ${field}`} />
        </label>
        <div className="w-72">
          <SelectMenu
            label="Kind"
            value={kind}
            onChange={(value) => {
              setKind(value as ScopeKind);
              if (value !== "nested") setTimeout(() => save.mutate(), 0);
            }}
            options={KINDS}
          />
        </div>
        {kind === "nested" ? (
          <div className="w-44">
            <SelectMenu
              label="Inside"
              value={parent}
              placeholder="Which set…"
              onChange={(value) => {
                setParent(value);
                setTimeout(() => save.mutate(), 0);
              }}
              options={scopes.filter((candidate) => candidate.id !== scope.id && candidate.kind !== "nested").map((candidate) => ({ value: candidate.id, label: candidate.code }))}
            />
          </div>
        ) : null}
        <button type="button" onClick={onRemove} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#e5b7b9] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#a6292f] hover:bg-[#fdf3f3]">
          <Trash2 size={13} aria-hidden="true" /> Remove set
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-[#a6292f]">{error}</p> : null}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">Groups</h4>
          <ul className="space-y-1.5">
            {scope.groups.map((group) => (
              <GroupRow key={group.id} group={group} parentGroups={parentScope?.groups ?? []} nested={kind === "nested"} onChanged={onChanged} onRemove={() => onRemoveGroup(group)} />
            ))}
          </ul>
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (groupLabel.trim()) makeGroup.mutate();
            }}
          >
            <input aria-label={`New group in ${scope.code}`} value={groupLabel} onChange={(event) => setGroupLabel(event.target.value)} placeholder="Group label" className={`w-28 ${field}`} />
            <button type="submit" disabled={!groupLabel.trim() || makeGroup.isPending} className="inline-flex items-center gap-1 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] disabled:opacity-50">
              <Plus size={12} aria-hidden="true" /> Add group
            </button>
          </form>
        </div>
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">Courses in this set</h4>
          <ul className="space-y-1">
            {scope.courses.map((course) => (
              <li key={course.id} className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-[#171717]">{course.code}</span>
                <span className="text-[#667085]">{course.name}{course.component ? ` · ${course.component}` : ""}</span>
                <button type="button" aria-label={`Remove ${course.code} from ${scope.code}`} onClick={() => removeCourse.mutate(course.id)} className="ml-auto rounded p-1 text-[#98a2b3] hover:text-[#a6292f]">
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (courseCode.trim()) makeCourse.mutate();
            }}
          >
            <input aria-label={`New course in ${scope.code}`} value={courseCode} onChange={(event) => setCourseCode(event.target.value)} placeholder="Course code" className={`w-28 ${field}`} />
            <input aria-label={`Component of the new course in ${scope.code}`} value={courseComponent} onChange={(event) => setCourseComponent(event.target.value)} placeholder="CM / TD / TP" className={`w-24 ${field}`} />
            <button type="submit" disabled={!courseCode.trim() || makeCourse.isPending} className="inline-flex items-center gap-1 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] disabled:opacity-50">
              <Plus size={12} aria-hidden="true" /> Add course
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function GroupRow({
  group,
  parentGroups,
  nested,
  onChanged,
  onRemove,
}: {
  group: CatalogueGroup;
  parentGroups: CatalogueGroup[];
  nested: boolean;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [capacity, setCapacity] = useState(String(group.capacity || ""));
  const [program, setProgram] = useState(group.program);
  useEffect(() => {
    setCapacity(String(group.capacity || ""));
    setProgram(group.program);
  }, [group]);
  const save = useMutation({
    mutationFn: (next: { capacity?: number; program?: string; parentGroupId?: string }) =>
      updateGroup(group.id, { label: group.label, capacity: next.capacity ?? group.capacity, note: group.note, program: next.program ?? group.program, parentGroupId: next.parentGroupId ?? group.parentGroupId }),
    onSuccess: onChanged,
  });
  const field = "rounded-md border border-[#cbd5e1] px-2 py-1 text-sm";

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-10 font-semibold text-[#171717]">{group.label}</span>
      <span className="text-xs text-[#98a2b3]">{group.assigned} placed</span>
      <input aria-label={`Capacity of group ${group.label}`} value={capacity} inputMode="numeric" placeholder="cap." onChange={(event) => setCapacity(event.target.value)} onBlur={() => (Number(capacity) || 0) !== group.capacity && save.mutate({ capacity: Number(capacity) || 0 })} className={`w-16 tabular-nums ${field}`} />
      <input aria-label={`Programme group ${group.label} prefers`} value={program} placeholder="prefers…" onChange={(event) => setProgram(event.target.value)} onBlur={() => program !== group.program && save.mutate({ program })} className={`w-36 ${field}`} />
      {nested ? (
        <select aria-label={`Parent group of ${group.label}`} value={group.parentGroupId} onChange={(event) => save.mutate({ parentGroupId: event.target.value })} className={field}>
          <option value="">inside…</option>
          {parentGroups.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.label}
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" aria-label={`Remove group ${group.label}`} onClick={onRemove} className="ml-auto rounded p-1 text-[#98a2b3] hover:text-[#a6292f]">
        <Trash2 size={12} aria-hidden="true" />
      </button>
    </li>
  );
}
