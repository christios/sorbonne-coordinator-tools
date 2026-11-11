import { describe, expect, it } from "vitest";

import { cardKind, switchCardKind } from "@/services/scheduleCardKind";

describe("turning a schedule card from one kind into the other", () => {
  it("makes a graded activity a session, its name the topic, and keeps the rest for coming back", () => {
    const exam = { id: "c1", kind: "graded", name: "Midterm", type: "Written test / examination", week: "8", date: "2027-03-02", weight: "30", cloIds: "a" };

    const session = switchCardKind(exam, "session");

    expect(cardKind(session)).toBe("session");
    expect(session).toMatchObject({ id: "c1", topic: "Midterm", week: "8", date: "2027-03-02", weight: "30" });
    expect(switchCardKind(session, "graded")).toEqual({ ...exam, topic: "Midterm" });
  });

  it("names a graded activity after the first line of the session's topic, keeping a name it had", () => {
    const lab = { id: "c2", topic: "Lab 1: Image formation\n- Lenses", week: "3", duration: "3", sessionType: "TP" };

    expect(switchCardKind(lab, "graded")).toMatchObject({ kind: "graded", name: "Lab 1: Image formation", week: "3", duration: "3" });
    expect(switchCardKind({ ...lab, name: "Lab report 1" }, "graded").name).toBe("Lab report 1");
  });

  it("uses the activity's type for the topic when it has no name, and leaves a card of the right kind alone", () => {
    expect(switchCardKind({ id: "c3", kind: "graded", type: "Quiz" }, "session").topic).toBe("Quiz");
    const session = { id: "c4", topic: "Rays" };
    expect(switchCardKind(session, "session")).toBe(session);
  });
});
