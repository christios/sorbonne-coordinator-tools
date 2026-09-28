import { describe, expect, it } from "vitest";

import { overCapacity, roomFinder, roomKey, type Room } from "@/services/rooms";

/** The estates office's list, 28 Sep 2026, as loaded. */
const CODES = [
  "3.001",
  "4.001",
  "4.002",
  "4.003",
  "4.004",
  "4.005",
  "4.006",
  "4.007",
  "4.008",
  "4.009/4.011",
  "4.010/4.012",
  "4.014",
  "4.015",
  "4.019",
  "4.021",
  "4.023",
  "4.024",
  "4.101/4.103",
  "4.104",
  "4.105/4.107",
  "4.106",
  "4.108",
  "4.109",
  "4.110",
  "4.111",
  "4.112/4.114",
  "4.113/4.115",
  "4.116",
  "4.119",
  "4.123",
  "4.124/4.126",
  "4.125",
  "4.127",
  "4.128",
  "4.131",
  "4.132",
  "4.133",
  "4.134",
  "4.135",
  "4.136",
  "4.137",
  "4.138",
  "5.001/5.003",
  "5.002",
  "5.004/5.006",
  "5.005/5.007",
  "5.008",
  "5.009",
  "5.010/5.012",
  "5.011/5.013",
  "5.014",
  "5.016",
  "5.019",
  "5.020/5.022",
  "5.021",
  "5.023/5.025",
  "5.024",
  "5.026",
  "5.027",
  "5.031",
  "5.032",
  "5.033/5.035",
  "5.034",
  "5.101/5.103",
  "5.104",
  "5.105/5.107",
  "5.108",
  "5.109",
  "5.110",
  "5.111",
  "5.112",
  "5.113/5.115",
  "5.114/5.116",
  "5.118",
  "5.120",
  "5.123",
  "5.124",
  "5.125",
  "5.126",
  "5.127",
  "5.128",
  "5.129",
  "5.130",
  "5.131",
  "5.135",
  "5.137",
  "5.138/5.140",
  "5.139",
  "7.113",
  "7.119",
  "A-2-14",
  "Richelieu" /* also B5.Richeli */,
  "Roberto Sorbonne" /* also B4.Robert */,
];
const room = (code: string, seats: number | null = 24, aliases: string[] = []): Room => ({
  id: code, code, name: "", building: "", kind: "", seats, aliases, updatedAt: "", updatedBy: "",
});
const LIST = [
  ...CODES.filter((code) => !["Roberto Sorbonne", "Richelieu"].includes(code)).map((code) => room(code)),
  room("Roberto Sorbonne", 154, ["B4.Robert"]),
  room("Richelieu", 156, ["B5.Richeli"]),
];
/** Every room the portal's timetable named for Semester 1, 28 Sep 2026. */
const PORTAL = ["3.024-Oval", "4.002", "4.008", "4.009/.011", "4.019", "4.021", "4.024", "4.101/.103", "4.105/.107", "4.106", "4.110", "4.112/.114", "4.113/.115", "4.119", "4.124/.126", "4.125", "4.127", "4.128", "4.131", "4.132", "4.133", "4.135", "4.137", "4.138", "5.001/.003", "5.002", "5.004/.006", "5.008", "5.010/.012", "5.011/.013", "5.014", "5.016", "5.019", "5.020/.022", "5.021", "5.024", "5.026", "5.033/.035", "5.101/.103", "5.104(Phys", "5.105/.107", "5.109", "5.110", "5.111", "5.112", "5.113/.115", "5.114/.116", "5.123", "5.127", "5.128", "5.130", "5.131", "5.135", "5.137", "5.138/.140", "5.139", "7.113-1st", "7.119(Rese", "B4.Robert", "B5.Richeli"];

describe("a room as the portal writes it", () => {
  it("reads the portal's shorthand for a pair, and a description run on after the number", () => {
    expect(roomKey("5.101/.103")).toBe(roomKey("5.101/5.103"));
    expect(roomKey("5.104(Phys")).toBe("5.104");
    expect(roomKey("7.113-1st")).toBe("7.113");
    expect(roomKey(" b4.Robert ")).toBe("B4.ROBERT");
  });

  it("finds every room the portal books but the one the list does not have", () => {
    const find = roomFinder(LIST);
    expect(PORTAL.filter((name) => !find(name))).toEqual(["3.024-Oval"]);
    expect(find("B4.Robert")?.seats).toBe(154);
    expect(find("5.033/.035")?.code).toBe("5.033/5.035");
  });

  it("calls a class too big for its room only where both numbers are known", () => {
    expect(overCapacity(32, room("5.111", 24))).toEqual({ registered: 32, seats: 24 });
    expect(overCapacity(24, room("5.111", 24))).toBeNull();
    expect(overCapacity(32, room("5.032", null))).toBeNull();
    expect(overCapacity(32, null)).toBeNull();
  });
});
