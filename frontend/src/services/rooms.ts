/**
 * The rooms and how many each seats — kept on the Rooms page, from the estates office's
 * list after the Summer 2026 works.
 *
 * The registrar's timetable names a room its own way: "5.101/.103" for the pair the list
 * calls 5.101/5.103, "5.104(Phys" and "7.113-1st" with a word of description run on,
 * "B4.Robert" for the Roberto Sorbonne amphitheatre. `roomKey` reads all of these to the
 * same key, and a room's other names cover what no rule could guess.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/rooms`;

export type Room = {
  id: string;
  /** "5.101/5.103", "4.021", "Roberto Sorbonne". */
  code: string;
  /** The longer name, where it has one: "Roberto Sorbonne (01.G0.13)". */
  name: string;
  building: string;
  /** Classroom, PC Lab, Amphi Theatre. */
  kind: string;
  /** Empty where nobody has said. */
  seats: number | null;
  /** Other names the portal's timetable uses for it: "B4.Robert". */
  aliases: string[];
  updatedAt: string;
  updatedBy: string;
};

export type RoomInput = Pick<Room, "code" | "name" | "building" | "kind" | "seats" | "aliases">;

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "That could not be saved. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the default sentence stands
    }
    throw new Error(detail);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function fetchRooms(): Promise<Room[]> {
  return (await answer<{ rooms: Room[] }>(await apiFetch(BASE))).rooms;
}

export async function addRoom(room: RoomInput): Promise<Room> {
  return answer(await apiFetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(room) }));
}

export async function updateRoom(id: string, room: RoomInput): Promise<Room> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(room),
    }),
  );
}

export async function removeRoom(id: string): Promise<void> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

/**
 * The key a room is known by, however it is written.
 *
 * Case and spaces go; a description run on after the number goes ("5.104(Phys" is 5.104,
 * "7.113-1st" is 7.113); and a pair written the registrar's short way is written out
 * ("5.101/.103" is 5.101/5.103).
 */
export function roomKey(name: string): string {
  let key = name.toUpperCase().replace(/\s+/g, "");
  key = key.replace(/\(.*$/, "");
  key = key.replace(/^(\d+\.\d+(?:\/\d*\.?\d+)?)-.*$/, "$1");
  key = key.replace(/^(\d+)\.(\d+)\/\.(\d+)$/, "$1.$2/$1.$3");
  return key;
}

/** Which room a name from the portal's timetable is, or null where the list has none. */
export function roomFinder(rooms: Room[]): (name: string) => Room | null {
  const byKey = new Map<string, Room>();
  for (const room of rooms) {
    for (const name of [room.code, ...room.aliases]) {
      const key = roomKey(name);
      if (key && !byKey.has(key)) byKey.set(key, room);
    }
  }
  return (name: string) => (name.trim() ? (byKey.get(roomKey(name)) ?? null) : null);
}

/** The rooms, read once for the page, and the finder over them. */
export function useRooms(enabled = true): { rooms: Room[]; roomOf: (name: string) => Room | null } {
  const read = useQuery({ queryKey: ["rooms"], queryFn: fetchRooms, enabled, staleTime: 60_000, retry: false });
  const rooms = useMemo(() => read.data ?? [], [read.data]);
  const roomOf = useMemo(() => roomFinder(rooms), [rooms]);
  return { rooms, roomOf };
}

/** "24 seats", or "" where the room or its seats are not known. */
export function seatsSaid(room: Room | null): string {
  return room && room.seats !== null ? `${room.seats} seat${room.seats === 1 ? "" : "s"}` : "";
}

/**
 * Whether a class is in a room too small for it: more registered than the room seats.
 * Null where either number is not known — an unknown is not a room big enough.
 */
export function overCapacity(registered: number | null | undefined, room: Room | null): { registered: number; seats: number } | null {
  if (!room || room.seats === null || !registered) return null;
  return registered > room.seats ? { registered, seats: room.seats } : null;
}
