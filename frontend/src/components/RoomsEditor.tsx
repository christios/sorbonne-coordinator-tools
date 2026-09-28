import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { addRoom, removeRoom, roomFinder, updateRoom, useRooms, type Room, type RoomInput } from "@/services/rooms";

const FIELD =
  "w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-[#171717] hover:border-[#d9dee7] focus:border-[#1f4e79] focus:bg-white focus:outline-none";

function inputOf(room?: Room, code = ""): RoomInput {
  return {
    code: room?.code ?? code,
    name: room?.name ?? "",
    building: room?.building ?? "",
    kind: room?.kind ?? "",
    seats: room?.seats ?? null,
    aliases: room?.aliases ?? [],
  };
}

function same(left: RoomInput, right: RoomInput): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * One room, edited where it stands: change a figure, press Save (or Enter), and it is the
 * department's. A new room is the same row with nothing saved yet.
 */
function RoomRow({ room, code = "", onDone }: { room?: Room; code?: string; onDone?: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<RoomInput>(() => inputOf(room, code));
  const [aliases, setAliases] = useState(() => (room?.aliases ?? []).join(", "));
  const held = { ...draft, aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean) };
  const changed = !room || !same(held, inputOf(room));
  const save = useMutation({
    mutationFn: () => (room ? updateRoom(room.id, held) : addRoom(held)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["rooms"] });
      onDone?.();
    },
  });
  const remove = useMutation({
    mutationFn: () => removeRoom(room!.id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["rooms"] }),
  });
  const set = (patch: Partial<RoomInput>) => setDraft((current) => ({ ...current, ...patch }));
  const submit = () => {
    if (changed && held.code.trim()) save.mutate();
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };
  const label = room?.code || "new room";
  return (
    <>
      <tr className={`border-b border-[#f2f4f7] align-top ${room ? "" : "bg-[#f8fbff]"}`}>
        <td className="px-1.5 py-1">
          <input aria-label={`Code of ${label}`} value={draft.code} onChange={(event) => set({ code: event.target.value })} onKeyDown={keys} placeholder="5.111" className={`${FIELD} font-semibold`} />
        </td>
        <td className="px-1.5 py-1">
          <input aria-label={`Other names of ${label}`} value={aliases} onChange={(event) => setAliases(event.target.value)} onKeyDown={keys} placeholder={room ? "" : "as the portal writes it"} className={FIELD} />
        </td>
        <td className="px-1.5 py-1">
          <input aria-label={`Building of ${label}`} value={draft.building} onChange={(event) => set({ building: event.target.value })} onKeyDown={keys} placeholder="B-5, FF" className={FIELD} />
        </td>
        <td className="px-1.5 py-1">
          <input aria-label={`Type of ${label}`} value={draft.kind} onChange={(event) => set({ kind: event.target.value })} onKeyDown={keys} placeholder="Classroom" className={FIELD} />
        </td>
        <td className="px-1.5 py-1">
          <input
            aria-label={`Seats in ${label}`}
            inputMode="numeric"
            value={draft.seats ?? ""}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              set({ seats: digits ? Number(digits) : null });
            }}
            onKeyDown={keys}
            placeholder="—"
            className={`${FIELD} text-right tabular-nums`}
          />
        </td>
        <td className="whitespace-nowrap px-1.5 py-1 text-right">
          {changed ? (
            <button
              type="button"
              onClick={submit}
              disabled={save.isPending || !held.code.trim()}
              className="rounded-md bg-[#1f4e79] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              {room ? "Save" : "Add"}
            </button>
          ) : null}
          {room ? (
            <button
              type="button"
              aria-label={`Take ${room.code} off the list`}
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="ml-1 rounded p-1 text-[#98a2b3] hover:bg-[#fff5f5] hover:text-[#a6292f] disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          ) : null}
        </td>
      </tr>
      {save.error || remove.error ? (
        <tr>
          <td colSpan={6} className="px-3 pb-2 text-xs text-[#a6292f]">
            {((save.error || remove.error) as Error).message}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The rooms and their seats, kept by the department — opened from the Rooms page.
 *
 * The list came from the estates office after the Summer 2026 works; this is where it is
 * corrected when a room is refitted, and where a room the portal books that the list has
 * never heard of is added. Every class is held against these numbers: a room too small
 * for the students registered in it is marked on the week and on the CRN.
 */
export function RoomsEditor({ portalRooms, onClose }: { portalRooms: string[]; onClose: () => void }) {
  const { rooms } = useRooms();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string[]>([]);
  const find = roomFinder(rooms);
  const unknown = [...new Set(portalRooms.filter((name) => name.trim() && !find(name)))].sort();
  const words = query.trim().toLowerCase();
  const shown = rooms.filter((room) =>
    !words ? true : [room.code, room.name, room.building, room.kind, ...room.aliases].join(" ").toLowerCase().includes(words),
  );
  const noted = rooms.filter((room) => room.seats !== null).length;
  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title="Rooms and their seats"
      description={`${rooms.length} rooms, ${noted} with their seats. A class with more students registered than its room seats is marked on the week and on its CRN.`}
    >
      {unknown.length ? (
        <div className="mb-3 rounded-lg border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]">
          <p className="font-semibold">The portal books {unknown.length === 1 ? "a room" : `${unknown.length} rooms`} this list does not have</p>
          <p className="mt-0.5 text-xs">Add it with its seats, or add the name to a room's other names if it is one the list has under another code.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unknown.map((name) => (
              <button
                key={name}
                type="button"
                disabled={adding.includes(name)}
                onClick={() => setAdding((current) => [...current, name])}
                className="inline-flex items-center gap-1 rounded-full border border-[#d9c48a] bg-white px-2 py-0.5 text-xs font-semibold text-[#8a6116] hover:bg-[#fffaf0] disabled:opacity-50"
              >
                <Plus size={12} aria-hidden="true" /> {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#98a2b3]" aria-hidden="true" />
          <input
            aria-label="Search rooms"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rooms"
            className="w-full rounded-md border border-[#cbd5e1] py-1.5 pl-8 pr-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => setAdding((current) => [...current, ""])}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Plus size={14} aria-hidden="true" /> Add a room
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#e4e8ef] text-left text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">
              <th scope="col" className="w-36 px-3 py-2">Room</th>
              <th scope="col" className="px-3 py-2" title="Other names the portal's timetable uses for it, separated by commas">Other names</th>
              <th scope="col" className="w-32 px-3 py-2">Building</th>
              <th scope="col" className="w-36 px-3 py-2">Type</th>
              <th scope="col" className="w-20 px-3 py-2 text-right">Seats</th>
              <th scope="col" className="w-24 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {adding.map((code, index) => (
              <RoomRow
                key={`new-${index}-${code}`}
                code={code}
                onDone={() => setAdding((current) => current.filter((_, at) => at !== index))}
              />
            ))}
            {shown.map((room) => (
              <RoomRow key={`${room.id}-${room.updatedAt}`} room={room} />
            ))}
          </tbody>
        </table>
        {!shown.length && !adding.length ? (
          <p className="px-3 py-6 text-center text-sm text-[#667085]">{rooms.length ? "No room matches." : "No rooms yet. Add the first."}</p>
        ) : null}
      </div>
    </Modal>
  );
}
